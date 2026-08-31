import type { StragglingTask } from "../../../olt/scripts/src/orchestrator/velocity-rebalancer.ts";

export function createSampleStragglerTask(overrides: Partial<StragglingTask> = {}): StragglingTask {
  return {
    id: "task-straggler-sample",
    elapsed_seconds: 350,
    scope_files: ["src/a.ts", "src/b.ts", "src/c.ts"],
    work_units: 3,
    span_length: 1,
    ...overrides,
  };
}
