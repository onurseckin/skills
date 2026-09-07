import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { join } from "node:path";
import type { RunState } from "../../../olt/scripts/src/core/contracts/index.ts";
import { canonicalJsonBytes } from "../../../olt/scripts/src/core/json.ts";
import { renderHandoff } from "../../../olt/scripts/src/reporting/handoff.ts";
import { initRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import { dispatchFailures, handoffArgv } from "../core/dispatchable.ts";
import { STATUSES } from "./handoff-statuses.ts";
import {
  cleanupVirtualReportingFS,
  getVirtualReportingFS,
  setupVirtualReportingFS,
  tempDir,
} from "../fixture.ts";

mock.module("../../../olt/scripts/src/engine/store/integrity/integrity.ts", () => ({
  verifyIntegrity: () => [],
}));

export const handoffArgvRegistryEdgeSuiteName = "handoff argv shape and state dispatch validation";

export const roots: string[] = [];
export const sharedRoots: string[] = [];

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

export async function capsule(
  name: string,
  status: string,
  mutate: (state: RunState) => void = () => {},
  sink: string[] = roots,
): Promise<string> {
  const repo = tempDir(`argv-${name}`);
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

export async function preplanCapsule(name: string, sink: string[] = roots): Promise<string> {
  const repo = tempDir(`argv-preplan-${name}`);
  sink.push(repo);
  return initRun(repo, `argv-preplan-${name}`, new TextEncoder().encode("Ship it"), "file", true);
}

const statusArgv = new Map<string, string[][]>();
const shapeArgv = new Map<string, string[][]>();

let sharedRun: string | null = null;
let baseState: RunState | null = null;

export async function argvForStatus(status: string): Promise<string[][]> {
  const cached = statusArgv.get(status);
  if (cached !== undefined) return cached;
  const vfs = getVirtualReportingFS();
  if (!sharedRun || !vfs.existsSync(sharedRun)) {
    sharedRun = await capsule("shared-status", status, () => {}, sharedRoots);
    const raw = vfs.readFileSync(join(sharedRun, "state.json"), "utf-8");
    baseState = JSON.parse(raw) as RunState;
  } else if (baseState) {
    const nextState = structuredClone(baseState);
    const task = (nextState.tasks as Record<string, any>)["task-1"];
    if (task) {
      task.status = status;
      if (HELD.has(status)) {
        task.lease = {
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
        };
      } else {
        delete task.lease;
      }
    }
    vfs.writeFileSync(join(sharedRun, "state.json"), canonicalJsonBytes(nextState as any));
  }
  const argv = handoffArgv(renderHandoff(sharedRun));
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

describe(handoffArgvRegistryEdgeSuiteName, () => {
  beforeAll(async () => {
    setupVirtualReportingFS();
    for (const status of STATUSES) {
      await argvForStatus(status);
    }
  });

  beforeEach(() => {
    setupVirtualReportingFS();
  });

  afterEach(() => {
    roots.length = 0;
  });

  afterAll(() => {
    sharedRoots.length = 0;
    sharedRun = null;
    baseState = null;
    statusArgv.clear();
    shapeArgv.clear();
    cleanupVirtualReportingFS();
  });

  test("every status yields commands the CLI can dispatch", async () => {
    for (const status of STATUSES) {
      const argv = await argvForStatus(status);
      expect(argv.length).toBeGreaterThan(0);
      const failures = dispatchFailures(argv);
      expect(failures).toEqual([]);
    }
  });

  test("preplan capsule yields commands the CLI can dispatch", async () => {
    const preplanRun = await preplanCapsule("test-preplan");
    const argv = handoffArgv(renderHandoff(preplanRun));
    expect(argv.length).toBeGreaterThan(0);
    const failures = dispatchFailures(argv);
    expect(failures).toEqual([]);
  });

  test("dispatches cleanly for empty argv list", () => {
    expect(dispatchFailures([])).toEqual([]);
  });
});
