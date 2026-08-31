export {
  createSampleQueueItemInput,
  createSampleActiveQueueItem,
} from "./fixture.ts";

export {
  loadTaskQueue,
  saveTaskQueue,
  clearTaskQueue,
  cleanStaleTempFiles,
  withTaskQueueLock,
  withTaskQueueWriteLock,
} from "../../../olt/scripts/src/engine/tasks/queue/storage.ts";

export {
  TASK_STATUSES,
  TASK_PRIORITIES,
  DEFAULT_TASK_QUEUE_FILE,
  type TaskItem,
  type TaskStatus,
  type TaskPriority,
  type TaskSourceType,
} from "../../../olt/scripts/src/engine/tasks/queue/types.ts";

export {
  enqueueTask,
  claimTaskLease,
  renewTaskLease,
  releaseTaskLease,
  reclaimExpiredLeases,
  popNextEligibleTask,
} from "../../../olt/scripts/src/engine/tasks/queue/task-queue.ts";

export const TASK_QUEUE_SUITES = [
  "task-queue-concurrency",
  "task-queue-dependencies",
  "task-queue-lifecycle",
  "task-queue-persistence",
  "task-storage",
  "task-types",
] as const;
