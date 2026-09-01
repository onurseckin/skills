import { join } from "node:path";
import { initRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

let vfs = new VirtualMemoryFS();
let session: VirtualFSSession | undefined;
let runCounter = 0;

export function setupSupervisionVFS(): VirtualMemoryFS {
  cleanupSupervisionVFS();
  vfs = new VirtualMemoryFS();
  session = createVirtualFSSession(vfs);
  return vfs;
}

export function cleanupSupervisionVFS(): void {
  if (session) {
    session.cleanup();
    session = undefined;
  }
  vfs.reset();
}

export function supervisedRun(label: string, taskCount = 1): string {
  if (!session) {
    setupSupervisionVFS();
  }
  const root = `/virtual/orchestrator-supervised-run-${++runCounter}-${label}`;
  const repo = join(root, "repo");
  vfs.mkdirSync(repo, { recursive: true });
  const run = initRun(repo, "supervisor-run", new TextEncoder().encode("prompt"), "file", true);

  const taskIds = Array.from({ length: taskCount }, (_, index) => `t-${index + 1}`);
  transact(run, "planner", "seed-graph", {}, (draft) => {
    draft.graph = {
      schema: "harness.graph",
      version: 1,
      revision: 1,
      nodes: [
        { id: "requirement-1", type: "requirement", label: "R-001", requirement_id: "R-001" },
        ...taskIds.map((id) => ({
          id,
          type: "task" as const,
          label: id,
          requirement_ids: ["R-001"],
          write_scope: [`src/${id}`],
          resource_scope: [],
          status: "ready" as const,
          priority: 1,
          created_order: 1,
          effort: 1,
        })),
      ],
      edges: [],
      gates: [],
    };
    draft.requirements = {
      schema: "harness.requirements",
      version: 1,
      prompt_sha256: "0".repeat(64),
      requirements: [{ id: "R-001", disposition: "actionable", dependencies: [] }],
      dispositions: [],
    };
    draft.tasks = Object.fromEntries(
      taskIds.map((id) => [
        id,
        {
          id,
          status: "ready",
          requirement_ids: ["R-001"],
          write_scope: [`src/${id}`],
          resource_scope: [],
          priority: 1,
          created_order: 1,
          effort: 1,
          dependencies: [],
          attempts: [],
          history: [],
          repair_round: 0,
        },
      ]),
    );
  });
  return run;
}

export function fakeClock(startIso: string) {
  let now = new Date(startIso).valueOf();
  return {
    clock: { now: () => new Date(now) },
    sleep: async (ms: number): Promise<void> => {
      now += ms;
    },
    advance: (ms: number): void => {
      now += ms;
    },
  };
}

export const SUPERVISION_SUITES = [
  "defect-synthesizer",
  "failure-classifier",
  "loop-gate-honesty",
  "loop-runner",
  "recursive-critic-feedback",
  "supervise-reclaim-scoping",
  "supervision-tick",
  "supervision-watch",
  "supervisor",
] as const;
