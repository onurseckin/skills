import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunState } from "../../../olt/scripts/src/core/contracts/index.ts";
import { findCommand } from "../../../olt/scripts/src/cli/registry/index.ts";
import { renderHandoff } from "../../../olt/scripts/src/reporting/handoff.ts";
import { initRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import { commandRecord } from "../../workflow/shared/test-port.ts";
import { handoffArgv } from "../core/dispatchable.ts";

export const handoffArgvRegistryCoreSuiteName = "every command the restart document can name resolves in registry";

const REPORTING = join(process.cwd(), "olt/scripts/src/reporting");

const LITERAL_INVOCATION = /registryArgv\(\s*[A-Za-z_$][\w$]*\s*,\s*"([^"]+)"/g;
const INDIRECT_INVOCATION = /registryArgv\(\s*[A-Za-z_$][\w$]*\s*,\s*[A-Za-z_$][\w$]*\s*[,)]/g;
const NAME_LIST = /:\s*readonly string\[\]\s*=\s*\[([^\]]*)\]/g;
const QUOTED = /"([^"]+)"/g;

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

function reportingSources(): ReportingSource[] {
  return readdirSync(REPORTING)
    .filter((file) => file.endsWith(".ts") && file !== "registry-argv.ts")
    .map((file) => ({ file, source: readFileSync(join(REPORTING, file), "utf-8") }));
}

const SOURCES = reportingSources();
const EMITTABLE = [...new Set(SOURCES.flatMap(({ source }) => namesIn(source)))].sort();

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

describe(handoffArgvRegistryCoreSuiteName, () => {
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

export const sharedRoots: string[] = [];

afterAll(async () =>
  Promise.all(sharedRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

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
      },
    };
    mutate(state);
  });
  return run;
}
