export type {
  DefectSeverity,
  DefectStatus,
  DefectCategory,
  DefectResolutionProof,
  DefectOccurrence,
  DefectRecordInput,
  DefectEntry,
  AggregatedDefect,
  ParseDefectLogOptions,
  LiveDeduplicationOptions,
  DefectKeyOptions,
  DefectHypothesis,
  DefectRemediationAction,
} from "./core/types.ts";

export {
  normalizeObservationSignature,
  createFnv1aHash,
  createSha256Hash,
  createDefectContentHash,
  computeDefectDiscriminator,
  extractDefectKeywords,
  calculateDefectSimilarity,
} from "./core/discriminator.ts";

export {
  isRecord,
  normalizeText,
  categorizeDefect,
} from "./core/sanitizer.ts";

export {
  pickHigherSeverity,
  toAggregatedDefect,
  aggregateDefectEntries,
  withinDeduplicationWindow,
  mergeDefectSets,
  calculateDefectAggregateMetrics,
  clusterDefectsBySimilarity,
} from "./aggregator/index.ts";

export {
  LiveDefectDeduplicator,
  deduplicateDefectLog,
  parseAndDeduplicateDefectJsonl,
  serializeAggregatedDefectLog,
  streamDeduplicateDefects,
  createDefectDedupTransformStream,
  filterDefectStream,
} from "./dedup/index.ts";

export {
  ContinuousDefectFeedbackLoop,
  executeDomainTask,
  validateResolutionProof,
  verifyResolutionProofEmpirical,
  resolveDefect,
  formulateDefectHypotheses,
  synthesizeRemediationActions,
  synthesizeDeliberationRound,
  createDefectDeliberationRound,
  advanceDeliberationRound,
  DefectDeliberationPipeline,
  validateRegressionTest,
  promoteResolvedDefects,
  autoPromoteDefect,
  generateDefectRegressionTest,
  generateRegressionTestSuite,
  isDefectEligibleForPromotion,
  auditDefectLog,
  formatDefectAuditBrief,
  logBoundaryViolationDefect,
} from "./loop/index.ts";

export {
  syncDoctorFindingsToDefects,
  parseDefectsJsonl,
  serializeDefectsJsonl,
  resolveDefectsJsonlPath,
  LIFECYCLE_PHASES,
  validatePhaseTransition,
  enforceSequentialLifecycleOrdering,
} from "./sync/index.ts";
