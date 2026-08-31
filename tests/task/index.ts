import { TASK_QUEUE_SUITES } from "./queue/index.ts";
import { TASK_DEQUEUE_SUITES } from "./dequeue/index.ts";
import { TASK_PUSHBACK_SUITES } from "./pushback/index.ts";
import { TASK_COVERAGE_SUITES } from "./coverage/index.ts";

export {
  createSampleQueueItemInput,
  createSampleActiveQueueItem,
  loadTaskQueue,
  saveTaskQueue,
  clearTaskQueue,
  cleanStaleTempFiles,
  withTaskQueueLock,
  withTaskQueueWriteLock,
  TASK_STATUSES,
  TASK_PRIORITIES,
  DEFAULT_TASK_QUEUE_FILE,
  enqueueTask,
  claimTaskLease,
  renewTaskLease,
  releaseTaskLease,
  reclaimExpiredLeases,
  popNextEligibleTask,
  TASK_QUEUE_SUITES,
  type TaskItem,
  type TaskStatus,
  type TaskPriority,
  type TaskSourceType,
} from "./queue/index.ts";

export {
  createSampleTaskLease,
  createSampleCompletionReceipts,
  dequeueTask,
  assertSingleActiveLease,
  popNextEligibleTaskWithCleanup,
  completeTask,
  completeTaskUnlocked,
  failTask,
  failTaskUnlocked,
  assertValidActiveLease,
  validateCompletionReceipts,
  translateSuspendedLeases,
  TASK_DEQUEUE_SUITES,
} from "./dequeue/index.ts";

export {
  createSamplePushbackInput,
  resolveTaskPushbackPath,
  auditTaskVerificationClaims,
  validateAuthorityReviewPushbackCriteria,
  executeReviewPushback,
  TASK_PUSHBACK_SUITES,
} from "./pushback/index.ts";

export {
  createSampleTaskQueueStats,
  compactTaskQueue,
  pruneTaskQueue,
  getTaskQueueStats,
  listTasks,
  isTaskItem,
  isTaskStatus,
  isTaskPriority,
  validateTaskItem,
  TASK_COVERAGE_SUITES,
} from "./coverage/index.ts";

export const TASK_DOMAIN_SUITES = {
  queue: TASK_QUEUE_SUITES,
  dequeue: TASK_DEQUEUE_SUITES,
  pushback: TASK_PUSHBACK_SUITES,
  coverage: TASK_COVERAGE_SUITES,
} as const;
