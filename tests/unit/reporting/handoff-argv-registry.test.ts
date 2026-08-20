import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunState } from "../../../orchestrating-long-tasks/scripts/src/contracts/capsule.ts";
import { findCommand } from "../../../orchestrating-long-tasks/scripts/src/cli/registry/index.ts";
import { renderHandoff } from "../../../orchestrating-long-tasks/scripts/src/reporting/handoff.ts";
import { initRun, transact } from "../../../orchestrating-long-tasks/scripts/src/store/index.ts";
import { commandRecord } from "../workflow/test-port.ts";
import { dispatchFailures, handoffArgv } from "./dispatchable.ts";

const REPORTING = fileURLToPath(
  new URL("../../../orchestrating-long-tasks/scripts/src/reporting/", import.meta.url),
);

/** `registryArgv(entrypoint, "task:claim"` — the command name written into the call itself. */
const LITERAL_INVOCATION = /registryArgv\(\s*[A-Za-z_$][\w$]*\s*,\s*"([^"]+)"/g;
/** `registryArgv(entrypoint, name` — the name arrives from a list the next pattern reads. */
const INDIRECT_INVOCATION = /registryArgv\(\s*[A-Za-z_$][\w$]*\s*,\s*[A-Za-z_$][\w$]*\s*[,)]/g;
/** `const PREPLAN_NEXT_COMMANDS: readonly string[] = ["plan:status", ...]` */
const NAME_LIST = /:\s*readonly string\[\]\s*=\s*\[([^\]]*)\]/g;
const QUOTED = /"([^"]+)"/g;

/** Command names a module can hand to `registryArgv`, whether written inline or via a list. */
function namesIn(source: string): string[] {
  const names = [...source.matchAll(LITERAL_INVOCATION)].map(([, name]) => name!);
  for (const [, body] of source.matchAll(NAME_LIST)) {
    names.push(...[...body!.matchAll(QUOTED)].map(([, name]) => name!));
  }
  return names;
}

interface ReportingSource {
  file: string;
  source: string;
}

/** `registry-argv.ts` is the resolver; the names it mentions are its own parameters, not commands. */
function reportingSources(): ReportingSource[] {
  return readdirSync(REPORTING)
    .filter((file) => file.endsWith(".ts") && file !== "registry-argv.ts")
    .map((file) => ({ file, source: readFileSync(join(REPORTING, file), "utf-8") }));
}

const SOURCES = reportingSources();
const EMITTABLE = [...new Set(SOURCES.flatMap(({ source }) => namesIn(source)))].sort();

/**
 * Names the restart document has to be able to reach for a run to stay resumable: orientation,
 * dispatch, the task lifecycle, branch collection, completion and recovery. Asserted so a scan that
 * silently matched nothing cannot pass for a scan that found everything in order.
 */
const REQUIRED = [
  "branch:collect",
  "critic:review",
  "doctor",
  "plan:compile",
  "queue:wave",
  "recover",
  "run:complete",
  "run:exec",
  "run:status",
  "task:claim",
  "task:probe",
  "task:review",
  "task:submit",
];

describe("every command the restart document can name", () => {
  test("resolves in the command registry", () => {
    expect(EMITTABLE.filter((name) => findCommand(name) === undefined)).toEqual([]);
  });

  test("is found by a scan that reaches the call sites it claims to cover", () => {
    for (const name of REQUIRED) expect(EMITTABLE).toContain(name);
  });

  test("comes from a list the scan reads when it is not written into the call", () => {
    const indirect = SOURCES.filter(
      ({ source }) => [...source.matchAll(INDIRECT_INVOCATION)].length > 0,
    );

    // A name resolved through a variable is invisible to the literal scan, so a module that adds
    // one has to be read here before the registry check above can be trusted again: until then it
    // would report a clean scan over names it never saw.
    expect(indirect.map(({ file }) => file)).toEqual(["preplan-handoff.ts"]);
    for (const { source } of indirect) expect(namesIn(source).length).toBeGreaterThan(0);
  });

  test("is rejected when it is one of the invocations the CLI never had", () => {
    const invented = [
      'registryArgv(entrypoint, "status", [["run", run]]);',
      'registryArgv(entrypoint, "packet", [["run", run]]);',
      'registryArgv(entrypoint, "validate", [["run", run]]);',
      'const INVENTED: readonly string[] = ["plan-apply"];',
    ].join("\n");

    expect(
      namesIn(invented)
        .filter((name) => findCommand(name) === undefined)
        .sort(),
    ).toEqual(["packet", "plan-apply", "status", "validate"]);
  });
});

const roots: string[] = [];

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

/** Far enough ahead that no lease or validation window in these fixtures reads as expired: an
 * expired one puts the run into recovery, where the document names `recover` and nothing else. */
const ahead = () => new Date(Date.now() + 3_600_000).toISOString();

const HELD = new Set(["leased", "running"]);

const TASK_GATE = {
  id: "G-task",
  command: ["bun", "test", "focused"],
  cwd: ".",
  scope: "task",
  requirement_ids: ["R-1"],
  mandatory: true,
};

const RUN_GATE = {
  id: "G-run",
  command: ["bun", "test", "all"],
  cwd: ".",
  scope: "run",
  requirement_ids: [],
  mandatory: true,
};

const BRANCH = {
  id: "B-1",
  parent_task_id: "task-1",
  parent_agent_id: "worker-1",
  reason: "the parser rewrite blocks the API change",
  depth: 1,
  status: "open",
  opened_at: "2026-08-13T12:00:00.000Z",
  sub_tasks: [
    {
      id: "S-1",
      label: "Fix the parser",
      write_scope: ["src/parser"],
      status: "claimed",
      agent_id: "sub-1",
    },
  ],
};

const AGENT = {
  id: "worker-1",
  role: "implementer",
  parent_agent_id: "coordinator",
  parent_task_id: "task-1",
  host: "claude-code",
  granted_at: "2026-08-13T12:00:00.000Z",
  status: "active",
};

const TOPOLOGY = {
  revision: 1,
  max_parallel: 3,
  waves: [{ wave: 1, task_ids: ["task-1"] }],
  decisions: [],
};

const REPOSITORY_BINDING = {
  repository_root: "/repo",
  head_sha: "b".repeat(40),
  dirty: false,
};

/** A clean review with nothing outstanding, so completion's last remaining step is the seal. */
const COMPLETION_REVIEW = {
  critic_id: "critic-1",
  packet_id: "P-critic",
  graph_revision: 1,
  readiness_sha256: "a".repeat(64),
  repository_binding: REPOSITORY_BINDING,
  status: "clean",
  unresolved_finding_ids: [],
  findings: [],
  requirement_proofs: [],
  residual_risks: [],
  integrity_evidence: [],
  repository_command_ids: [],
  checks: [],
  reviewed_at: "2026-08-13T12:10:00.000Z",
  review_sha256: "c".repeat(64),
};

/** A critic whose window is still open: an expired one is stale evidence, and a run with stale
 * evidence is handed `recover` and nothing else, which is a different document entirely. */
const critic = (status: string) => ({
  critic_id: "critic-1",
  attempt: 1,
  status,
  started_at: "2026-08-13T12:00:00.000Z",
  deadline_at: ahead(),
  readiness_sha256: "a".repeat(64),
  repository_binding: structuredClone(REPOSITORY_BINDING),
});

function task(status: string): Record<string, unknown> {
  return {
    id: "task-1",
    status,
    requirement_ids: ["R-1"],
    dependencies: [],
    write_scope: ["src/**"],
    attempts: [],
    history: [],
    repair_round: 0,
    probe_round: 0,
    ...(HELD.has(status)
      ? { lease: { agent_id: "worker-1", role: "implementer", attempt: 1, expires_at: ahead() } }
      : {}),
    ...(status === "validating"
      ? {
          validations: [
            { validator_id: "val-1", domain: "code-quality", attempt: 1, deadline_at: ahead() },
          ],
        }
      : {}),
  };
}

/**
 * A capsule holding one task in the given status, with a branch, a grant, both gate scopes and a
 * topology in place, so the document has every section's worth of argv to print rather than the
 * subset a bare capsule reaches. `mutate` shapes the parts a status alone cannot reach.
 */
async function capsule(name: string, status: string, mutate: (state: RunState) => void = () => {}) {
  const repo = await mkdtemp(join(tmpdir(), `harness-argv-${name}-`));
  roots.push(repo);
  const run = initRun(
    repo,
    `argv-${name}`,
    new TextEncoder().encode("Ship the parser"),
    "file",
    true,
  );
  transact(run, "planner", "plan-applied", {}, (state: RunState) => {
    state.graph = {
      revision: 1,
      gates: [structuredClone(TASK_GATE), structuredClone(RUN_GATE)],
    };
    state.requirements = {
      requirements: [{ id: "R-1", disposition: "actionable", status: "planned", evidence: [] }],
    };
    state.tasks = { "task-1": task(status) };
    state.branches = [structuredClone(BRANCH)];
    state.agents = [structuredClone(AGENT)];
    state.topology = structuredClone(TOPOLOGY);
    mutate(state);
  });
  return run;
}

/** Every status `contracts/workflow.ts` declares a task can be sitting in when a run is picked up. */
const STATUSES = [
  "proposed",
  "ready",
  "retry_ready",
  "changes_requested",
  "leased",
  "running",
  "submitted",
  "validating",
  "validated",
  "gating",
  "branched",
  "escalated",
  "blocked",
  "cancelled",
  "stale",
  "done",
];

/** The run gate's own recorded success, so completion moves past the gates to the critic. */
const runGate = () =>
  commandRecord("C-RUN", { actor: "coordinator", task_id: null, gate_id: "G-run" });

/** The shapes a status alone does not reach: an unclaimed branch, a collectable one, and each stop
 * on the way from "every task is done" to a sealed capsule. */
const SHAPES: [name: string, status: string, mutate: (state: RunState) => void][] = [
  [
    "branch-unclaimed",
    "branched",
    (state) => {
      // No `agent_id` at all: nobody holds it yet, and a null would be a holder the ledger never
      // recorded rather than the absence it actually is.
      state.branches = [
        {
          ...structuredClone(BRANCH),
          sub_tasks: [
            { id: "S-1", label: "Fix the parser", write_scope: ["src/parser"], status: "open" },
          ],
        },
      ];
    },
  ],
  [
    "branch-collectable",
    "branched",
    (state) => {
      state.branches = [
        {
          ...structuredClone(BRANCH),
          status: "collecting",
          sub_tasks: [
            {
              id: "S-1",
              label: "Fix the parser",
              write_scope: ["src/parser"],
              status: "submitted",
              agent_id: "sub-1",
            },
          ],
        },
      ];
    },
  ],
  [
    "stale-lease",
    "leased",
    (state) => {
      // An expired lease is the one shape where the document withholds everything else: every other
      // command authenticates with a lease the harness has already stopped honouring.
      const tasks = state.tasks as Record<string, { lease: { expires_at: string } }>;
      tasks["task-1"]!.lease.expires_at = "2026-08-13T12:00:00.000Z";
    },
  ],
  ["completion-run-gate", "done", () => {}],
  [
    "completion-critic-start",
    "done",
    (state) => {
      state.commands = { "C-RUN": runGate() };
    },
  ],
  [
    "completion-critic-review",
    "done",
    (state) => {
      state.commands = { "C-RUN": runGate() };
      state.completion_critic = critic("assigned");
    },
  ],
  [
    "completion-seal",
    "done",
    (state) => {
      state.commands = { "C-RUN": runGate() };
      state.completion_critic = critic("reviewed");
      state.completion_review = structuredClone(COMPLETION_REVIEW);
    },
  ],
];

/** A capsule that was initialised and never compiled: the path `renderPreplanHandoff` serves. */
async function preplanCapsule(name: string): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), `harness-argv-preplan-${name}-`));
  roots.push(repo);
  return initRun(repo, `argv-preplan-${name}`, new TextEncoder().encode("Ship it"), "file", true);
}

describe("every argv line the rendered document prints", () => {
  test.each(STATUSES)("dispatches from a capsule whose task is %s", async (status) => {
    const argv = handoffArgv(renderHandoff(await capsule(status, status)));

    expect(argv.length).toBeGreaterThan(0);
    expect(dispatchFailures(argv)).toEqual([]);
  });

  test.each(SHAPES)("dispatches from a capsule shaped as %s", async (name, status, mutate) => {
    const argv = handoffArgv(renderHandoff(await capsule(name, status, mutate)));

    expect(argv.length).toBeGreaterThan(0);
    expect(dispatchFailures(argv)).toEqual([]);
  });

  test("across every shape names the whole lifecycle, and nothing the scan did not predict", async () => {
    const named = new Set<string>();
    const walked: [string, string, (state: RunState) => void][] = [
      ...STATUSES.map(
        (status) => [status, status, () => {}] as [string, string, (state: RunState) => void],
      ),
      ...SHAPES,
    ];
    for (const [name, status, mutate] of walked) {
      for (const argv of handoffArgv(renderHandoff(await capsule(name, status, mutate)))) {
        named.add(argv[2]!);
      }
    }
    // The pre-plan document is a second renderer with its own command list, so a walk that skipped
    // it would leave the whole path out of an uncompiled capsule unchecked.
    for (const argv of handoffArgv(renderHandoff(await preplanCapsule("union")))) {
      named.add(argv[2]!);
    }

    // The anchor the equality below cannot supply: two sets that shrank together still match, so a
    // run that quietly stopped naming the commands that move work forward would pass on equality
    // alone. These are named outright.
    for (const name of REQUIRED) expect([...named]).toContain(name);
    // The two halves are the same set, which says both things at once: nothing the document printed
    // escaped the source scan that checks names against the registry, and no name the source can
    // reach for is unreachable in practice — an emission path no capsule state arrives at is dead
    // code that the registry check would go on certifying forever.
    expect([...named].sort()).toEqual(EMITTABLE);
  });

  test("dispatches from a capsule whose plan was never applied", async () => {
    const argv = handoffArgv(renderHandoff(await preplanCapsule("alone")));

    expect(argv.length).toBeGreaterThan(0);
    expect(dispatchFailures(argv)).toEqual([]);
  });

  test("names an entrypoint that is on disk, on both renderers", async () => {
    const harness = fileURLToPath(
      new URL("../../../orchestrating-long-tasks/scripts/harness.ts", import.meta.url),
    );
    const documents = [
      renderHandoff(await capsule("entrypoint", "ready")),
      renderHandoff(await preplanCapsule("entrypoint")),
    ];

    for (const document of documents) {
      const argv = handoffArgv(document);
      expect(argv.length).toBeGreaterThan(0);
      // A registry-valid command behind a path that is not there still fails on paste, so the
      // entrypoint is checked against the filesystem rather than assumed from its shape.
      expect(argv.map(([, entrypoint]) => entrypoint).filter((path) => !existsSync(path!))).toEqual(
        [],
      );
      expect([...new Set(argv.map(([, entrypoint]) => entrypoint))]).toEqual([harness]);
    }
  });

  test("names the revision the capsule recorded, and refuses a graph that recorded none", async () => {
    expect(renderHandoff(await capsule("revision", "ready"))).toContain("Graph revision: 1");

    const repo = await mkdtemp(join(tmpdir(), "harness-argv-revisionless-"));
    roots.push(repo);
    const bare = initRun(
      repo,
      "argv-revisionless",
      new TextEncoder().encode("Ship it"),
      "file",
      true,
    );
    transact(bare, "planner", "plan-applied", {}, (state: RunState) => {
      state.graph = { gates: [] };
      state.tasks = {};
      state.requirements = { requirements: [] };
    });

    // Refused rather than described: a document that printed a revision here would be naming a plan
    // the capsule never recorded, which is the one thing this document must never do.
    expect(() => renderHandoff(bare)).toThrow("workflow requires a valid graph revision");
  });
});
