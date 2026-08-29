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
} from "./defects/core/types.ts";

export {
  normalizeObservationSignature,
  createFnv1aHash,
  createSha256Hash,
  createDefectContentHash,
  computeDefectDiscriminator,
  extractDefectKeywords,
  calculateDefectSimilarity,
} from "./defects/core/discriminator.ts";

export {
  isRecord,
  normalizeText,
  categorizeDefect,
} from "./defects/core/sanitizer.ts";

export {
  pickHigherSeverity,
  normalizeStatus,
  toAggregatedDefect,
  aggregateDefectEntries,
  withinDeduplicationWindow,
  mergeDefectSets,
  calculateDefectAggregateMetrics,
  clusterDefectsBySimilarity,
} from "./defects/aggregator/index.ts";

export {
  LiveDefectDeduplicator,
  deduplicateDefectLog,
  parseAndDeduplicateDefectJsonl,
  serializeAggregatedDefectLog,
  streamDeduplicateDefects,
  createDefectDedupTransformStream,
  filterDefectStream,
} from "./defects/dedup/index.ts";

export {
  validateResolutionProof,
  verifyResolutionProofEmpirical,
  resolveDefect,
  formulateDefectHypotheses,
  synthesizeBoundaryRemediationActions,
  formulateBoundaryViolationHypothesis,
  synthesizeRemediationActions,
  synthesizeDeliberationRound,
  createDefectDeliberationRound,
  advanceDeliberationRound,
  DefectDeliberationPipeline,
  formatDeliberationReport,
  generateDefectRegressionTest,
  generateRegressionTestSuite,
  isDefectEligibleForPromotion,
  validateRegressionTest,
  promoteResolvedDefects,
  autoPromoteDefect,
  formulateDefectCandidates,
  auditDefectLog,
  formatDefectAuditBrief,
  logBoundaryViolationDefect,
  resolveCanonicalDefectLogPath,
  resolveDefectLogPath,
  resolveCanonicalCompletedDefectsPath,
  resolveCompletedDefectsPath,
  readExistingDefectLog,
  readCompletedDefectsLog,
  writeCompletedDefectsLog,
  atomicWriteDefectLog,
  appendDefectLogEntry,
  appendCompletedDefectLogEntry,
  mergeDefectsById,
  ContinuousDefectFeedbackLoop,
} from "./defects/loop/index.ts";

export {
  syncDoctorFindingsToDefects,
  parseDefectsJsonl,
  serializeDefectsJsonl,
  resolveDefectsJsonlPath,
  LIFECYCLE_PHASES,
  validatePhaseTransition,
  enforceSequentialLifecycleOrdering,
} from "./defects/sync/index.ts";

export const DEFAULT_DEFECTS_FILE = "olt/defects.jsonl";
export const DEFAULT_COMPLETED_DEFECTS_FILE = "olt/completed-defects.jsonl";

export {
  parseDefectsJsonl as parseDefectLog,
  serializeDefectsJsonl as serializeDefectLog,
} from "./defects/sync/index.ts";
