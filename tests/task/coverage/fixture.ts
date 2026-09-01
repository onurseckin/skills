import type { TaskQueueStats } from "../../../olt/scripts/src/task/queue/index.ts";

export function createSampleTaskQueueStats(
  overrides: Partial<TaskQueueStats> = {},
): TaskQueueStats {
  return {
    total: 10,
    ready: 4,
    claimed: 2,
    completed: 3,
    failed: 1,
    suspended: 0,
    ...overrides,
  };
}
