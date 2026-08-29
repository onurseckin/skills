import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunState } from "../../../../olt/scripts/src/core/contracts/index.ts";
import { findCommand } from "../../../../olt/scripts/src/cli/registry/index.ts";
import { renderHandoff } from "../../../../olt/scripts/src/reporting/handoff.ts";
import { initRun, transact } from "../../../../olt/scripts/src/engine/store/index.ts";
import { commandRecord } from "../../workflow/test-port.ts";
import { dispatchFailures, handoffArgv } from "../core/dispatchable.ts";
import { STATUSES } from "./handoff-statuses.ts";

const REPORTING = fileURLToPath(new URL("../../../../olt/scripts/src/reporting/", import.meta.url));

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
      'registryArgv(entrypoint, "nonexistent-status", [["run", run]]);',
      'registryArgv(entrypoint, "packet", [["run", run]]);',
      'registryArgv(entrypoint, "validate", [["run", run]]);',
      'const INVENTED: readonly string[] = ["plan-apply"];',
    ].join("\n");

    expect(
      namesIn(invented)
        .filter((name) => findCommand(name) === undefined)
        .sort(),
    ).toEqual(["nonexistent-status", "packet", "plan-apply", "validate"]);
  });
});

export const roots: string[] = [];

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

/** Every status and shape capsule is built once and reused across the three describe blocks below
 * that each need its rendered argv: the fixtures are read-only after construction, so rebuilding
 * one per consumer would triple the real disk I/O for no behavioural difference. Torn down once,
 * after every consumer has had its turn. */
export const sharedRoots: string[] = [];

afterAll(async () =>
  Promise.all(sharedRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
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

const critic = (status: "assigned" | "reviewed") => ({
  critic_id: "critic-1",
  packet_id: "P-critic",
  started_at: "2026-08-13T12:00:00.000Z",
  deadline_at: ahead(),
  status: status === "assigned" ? ("packet_published" as const) : ("review_recorded" as const),
  token_digest: "a".repeat(64),
  readiness_sha256: "a".repeat(64),
  repository_binding: REPOSITORY_BINDING,
  attempt: 1,
});

export async function capsule(
  name: string,
  status: string,
  mutate: (state: RunState) => void = () => {},
  sink: string[] = roots,
): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), `harness-argv-${name}-`));
  sink.push(repo);
  const run = initRun(repo, `argv-${name}`, new TextEncoder().encode("Ship it"), "file", true);
  transact(run, "planner", "plan-applied", {}, (state: RunState) => {
    state.topology = structuredClone(TOPOLOGY);
    state.graph = { revision: 1, gates: [TASK_GATE, RUN_GATE] };
    state.requirements = { requirements: [{ id: "R-1", text: "Ship it" }] };
    state.agents = [structuredClone(AGENT)];
    state.tasks = {
      "task-1": {
        id: "task-1",
        label: "Fix the parser",
        requirement_ids: ["R-1"],
        status: status as unknown,
        priority: 50,
        probe_round: 0,
        repair_round: 0,
        write_scope: ["src/parser"],
        validation_history: [],
        history: [],
        ...(HELD.has(status)
          ? {
              lease: {
                agent_id: "worker-1",
                role: "implementer",
                token_digest: "a".repeat(64),
                write_scope: ["src/parser"],
                resource_scope: [],
                issued_at: "2026-08-13T12:00:00.000Z",
                heartbeat_at: "2026-08-13T12:00:00.000Z",
                expires_at: ahead(),
                attempt: 1,
                duration_seconds: 1200,
              },
            }
          : {}),
        ...(status === "validating"
          ? {
              validations: [
                {
                  validator_id: "val-1",
                  domain: "code-quality",
                  token_digest: "b".repeat(64),
                  started_at: "2026-08-13T12:00:00.000Z",
                  deadline_at: ahead(),
                  attempt: 1,
                },
              ],
            }
          : {}),
      },
    };
    mutate(state);
  });
  return run;
}

/** Every status `contracts/workflow.ts` declares a task can be sitting in when a run is picked up. */

/** The run gate's own recorded success, so completion moves past the gates to the critic. */
const runGate = () =>
  commandRecord("C-RUN", { actor: "coordinator", task_id: null, gate_id: "G-run" });

/** The shapes a status alone does not reach: an unclaimed branch, a collectable one, and each stop
 * on the way from "every task is done" to a sealed capsule. */
export const SHAPES: [name: string, status: string, mutate: (state: RunState) => void][] = [
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
    "branch-claimed",
    "branched",
    (state) => {
      state.branches = [
        {
          ...structuredClone(BRANCH),
          status: "open",
          sub_tasks: [
            {
              id: "S-1",
              label: "Fix the parser",
              write_scope: ["src/parser"],
              status: "claimed",
              agent_id: "sub-1",
            },
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
export async function preplanCapsule(name: string, sink: string[] = roots): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), `harness-argv-preplan-${name}-`));
  sink.push(repo);
  return initRun(repo, `argv-preplan-${name}`, new TextEncoder().encode("Ship it"), "file", true);
}

/** Every status the STATUSES table names, and every named shape, renders exactly one capsule: the
 * three test blocks below all need the same rendered argv, so the fixture is built once here and
 * shared rather than rebuilt per consumer. */
const statusArgv = new Map<string, string[][]>();
const shapeArgv = new Map<string, string[][]>();

export async function argvForStatus(status: string): Promise<string[][]> {
  const cached = statusArgv.get(status);
  if (cached !== undefined) return cached;
  const argv = handoffArgv(renderHandoff(await capsule(status, status, () => {}, sharedRoots)));
  statusArgv.set(status, argv);
  return argv;
}

export async function argvForShape(
  name: string,
  status: string,
  mutate: (state: RunState) => void,
): Promise<string[][]> {
  const cached = shapeArgv.get(name);
  if (cached !== undefined) return cached;
  const argv = handoffArgv(renderHandoff(await capsule(name, status, mutate, sharedRoots)));
  shapeArgv.set(name, argv);
  return argv;
}
