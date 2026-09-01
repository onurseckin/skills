export { createSampleTaskLease, createSampleCompletionReceipts } from "./fixture.ts";

export {
  dequeueTask,
  assertSingleActiveLease,
  popNextEligibleTask,
  popNextEligibleTaskWithCleanup,
  completeTask,
  completeTaskUnlocked,
  failTask,
  failTaskUnlocked,
  assertValidActiveLease,
  validateCompletionReceipts,
  translateSuspendedLeases,
} from "../../../olt/scripts/src/task/queue/index.ts";

export const TASK_DEQUEUE_SUITES = [
  "dequeue-anti-batching",
  "transitions-completion",
  "transitions-validation",
] as const;
