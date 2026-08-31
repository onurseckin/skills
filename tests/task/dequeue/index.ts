export {
  createSampleTaskLease,
  createSampleCompletionReceipts,
} from "./fixture.ts";

export {
  dequeueTask,
  assertSingleActiveLease,
  popNextEligibleTask,
  popNextEligibleTaskWithCleanup,
} from "../../../olt/scripts/src/engine/tasks/queue/dequeue.ts";

export {
  completeTask,
  completeTaskUnlocked,
  failTask,
  failTaskUnlocked,
  assertValidActiveLease,
  validateCompletionReceipts,
  translateSuspendedLeases,
} from "../../../olt/scripts/src/engine/tasks/queue/transitions.ts";

export const TASK_DEQUEUE_SUITES = [
  "dequeue-anti-batching",
  "transitions-completion",
  "transitions-validation",
] as const;
