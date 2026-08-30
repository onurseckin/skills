export {
  isArchivedItemType,
  __setArchivedObjectivesPersistenceTestHook,
  resolveCanonicalArchivedObjectivesPath,
  resolveArchivedObjectivesPath,
  ARCHIVED_ITEM_TYPES,
  BOILERPLATE_CAPSULE_SUBDIRECTORIES,
  DEFAULT_ARCHIVED_OBJECTIVES_FILE,
} from "./types.ts";
export type {
  ArchivedItemType,
  ArchivedObjectiveRecord,
  PruneBoilerplateOptions,
  PruneBoilerplateResult,
  ArchiveCapsuleOptions,
  ArchiveCapsuleResult,
  ConsolidateCapsulesOptions,
  ConsolidateCapsulesResult,
  PruneAndArchiveOptions,
  PruneAndArchiveResult,
} from "./types.ts";

export { validateArchivedObjectiveRecord, readArchivedObjectives } from "./generational.ts";

export { writeArchivedObjectives } from "./compactor.ts";

export { appendArchivedObjectives, isItemCompleted, extractItemGeneration } from "./reader.ts";

export { pruneAndArchiveGenerationalState, isEffectivelyEmptyDirectory } from "./writer.ts";

export { pruneCapsuleBoilerplate, assertCapsuleCopyComplete, archiveCapsule } from "./validator.ts";

export { consolidateCapsules } from "./pruner.ts";

export {
  executeQuiesceLane,
  buildQuiescentDigest,
  calculateQuiescentInterval,
  computeQuiescentStreak,
  formatQuiescentDigestMarkdown,
  parseQuiescentSourceSpec,
  shouldTriggerQuiescentDigest,
  tryParseQuiescentSourceSpec,
  validateQuiescentScan,
  QUIESCENT_DIGEST_STREAK_THRESHOLD,
  DEFAULT_BASE_INTERVAL_MS,
  DEFAULT_MAX_INTERVAL_MS,
  QUIESCENCE_INTERVAL_MULTIPLIER,
} from "./quiesce/index.ts";
export type {
  QuiescentSourceObservation,
  QuiescentSourceInput,
  QuiescentValidationResult,
  QuiescentDigest,
  ExecuteQuiesceLaneOptions,
  QuiesceLaneOptions,
  QuiesceLaneResult,
} from "./quiesce/index.ts";

export {
  readCompletedTasksLedger,
  writeCompletedTasksLedger,
  writeCompletedTasksLedgerUnlocked,
  updateFeedbackQueueItems,
  updateDefectItems,
  recordCompletedTasksBatch,
  recordCompletedTasksBatchUnlocked,
  recordCompletedTask,
  getCompletedTasksStats,
  formatCompletedTasksBrief,
  migrateCompletedTasksLedger,
  atomicWriteLedger,
  validateCompletedTaskSource,
  validateCompletedTaskStatus,
  validateCompletedTaskRecord,
  resolveCanonicalCompletedTasksPath,
  resolveCompletedTasksLedgerPath,
} from "./completed/index.ts";
export type {
  CompletedTaskSource,
  CompletedTaskStatus,
  CompletedTaskRecord,
  CompletedTasksStats,
  RecordCompletedTaskOptions,
} from "./completed/index.ts";

export {
  assessRecyclingState,
  transitionCompletenessCriticSignOff,
  transitionPulseToWake,
  transitionPulseCloseToWake,
  drainAndAdmitFeedbackCandidates,
  compileAutonomicWavePlan,
  executeAutonomicRollover,
  formatAutonomicRolloverBrief,
  planAutonomousRoundRecycle,
  formatRecycleBrief,
  enforceInfiniteMindCadence,
  inspectRecycleHealth,
  validateRolloverReadiness,
  extractAllCandidates,
} from "./recycler/index.ts";
export type {
  RecycleTransitionType,
  RecyclePhase,
  RecycleAssessment,
  AssessRecyclingOptions,
  AutonomousRecycleOptions,
  RecyclePlan,
  ConcurrencyWavePlan,
  AutonomicWavePlanOptions,
  AutonomicWavePlanResult,
  DrainAndAdmitOptions,
  DrainAndAdmitResult,
  AutonomicRolloverOptions,
  AutonomicRolloverResult,
  MindRecycleHealth,
} from "./recycler/index.ts";

export {
  rotateMindGeneration,
  finishRotation,
  readRotationMetadata,
  getGenerationLineage,
} from "./rotate/index.ts";
export type {
  RotateMindOptions,
  RotateMindResult,
  FinishRotationOptions,
  GenerationLineageNode,
  RotationMetadata,
} from "./rotate/index.ts";

export { deployHierarchy } from "../lifecycle/deploy/index.ts";
