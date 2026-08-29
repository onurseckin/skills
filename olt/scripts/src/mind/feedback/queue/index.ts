export type {
  FeedbackPriority,
  FeedbackStatus,
  FeedbackCategory,
  FeedbackResolutionProof,
  FeedbackItem,
  FeedbackQueueStats,
  AtomicAdmissionDispatchResult,
  AdmissionDispatchIntegrityReport,
  BackpropagationRecord,
} from "./types.ts";

export {
  CANONICAL_FEEDBACK_FILE,
  DEFAULT_FEEDBACK_FILE,
  PRIORITY_ORDER,
  resolveCanonicalFeedbackQueuePath,
  resolveFeedbackQueuePath,
  __setFeedbackQueuePersistenceTestHook,
} from "./types.ts";

export { validateFeedbackResolutionProof } from "./storage.ts";

export {
  verifyFeedbackEmpiricalSealing,
  readFeedbackQueueStrict,
  readFeedbackQueue,
} from "./ingest.ts";

export { writeFeedbackQueue, withFeedbackQueueTransaction } from "./admission.ts";

export {
  clearFeedbackQueue,
  appendFeedbackItem,
  appendFeedbackItemsDedupedByTitle,
  updateOrPruneFeedbackItems,
  ingestFeedbackItem,
  admitFeedbackToQueue,
  updateFeedbackItem,
  sealFeedbackResolution,
} from "./ops.ts";

export {
  backpropagateFeedbackResolution,
  drainPendingFeedbacks,
  compareFeedbackPriority,
  sortFeedbackByPriority,
  getFeedbackStats,
} from "./filter.ts";

export {
  admitAndDispatchFeedbackAtomically,
  auditAdmissionDispatchIntegrity,
  reconcilePausedAdmittedFeedbacks,
  migrateFeedbackQueue,
} from "./metrics.ts";
