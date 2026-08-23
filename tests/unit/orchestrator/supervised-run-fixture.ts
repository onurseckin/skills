import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { initRun, transact } from "../../../olt/scripts/src/store/index.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

/**
 * One ready, dependency-free task ("t-1") with its requirement pre-authorized, plus enough of a
 * graph/requirements/tasks shape for proposeBatch/taskExecutionState to treat it as dispatchable —
 * the same recipe tests/unit/scheduler/fixtures.ts's schedulerState() uses, written through a real
 * capsule (initRun/transact) instead of a bare object, since these orchestrator suites read/write a
 * real run through workflowPort.
 */
export function supervisedRun(label: string, taskCount = 1): string {
  const root = scratchRoot(import.meta.path, label);
  const repo = join(root, "repo");
  mkdirSync(repo);
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
          type: "task",
          label: id,
          requirement_ids: ["R-001"],
          write_scope: [`src/${id}`],
          resource_scope: [],
          status: "ready",
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
