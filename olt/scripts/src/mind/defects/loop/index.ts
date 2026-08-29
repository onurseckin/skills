export type {
  DomainExecutionStatus,
  DomainExecutionContext,
  DomainExecutionTask,
  DomainTaskResult,
  DomainMetrics,
  DefectFeedbackCycle,
  DefectLoopOptions,
  DefectLoopMetrics,
  QueuedTaskEntry,
} from "./types.ts";

export {
  validateResolutionProof,
  verifyResolutionProofEmpirical,
  resolveDefect,
} from "./resolution.ts";

export {
  formulateDefectHypotheses,
  synthesizeBoundaryRemediationActions,
  synthesizeRemediationActions,
  synthesizeDeliberationRound,
  createDefectDeliberationRound,
  advanceDeliberationRound,
  DefectDeliberationPipeline,
  formatDeliberationReport,
  type DeliberationSynthesis,
  type DefectDeliberationRound,
} from "./deliberation/index.ts";

export {
  generateDefectRegressionTest,
  generateRegressionTestSuite,
  isDefectEligibleForPromotion,
} from "./regression-gen.ts";
export type { GeneratedRegressionTest } from "./regression-gen.ts";

export { validateRegressionTest, promoteResolvedDefects, autoPromoteDefect } from "./promotion.ts";
export type { DefectPromotionOptions, DefectPromotionResult } from "./promotion.ts";

export { formulateDefectCandidates } from "./candidates.ts";
export type { MindCandidateProposal } from "./candidates.ts";

export {
  auditDefectLog,
  executeDefectAudit,
  formatDefectAuditBrief,
  logBoundaryViolationDefect,
} from "./audit.ts";
export type { DefectAuditReport } from "./audit.ts";

export {
  DEFAULT_DEFECTS_FILE,
  CANONICAL_DEFECTS_FILE,
  DEFAULT_COMPLETED_DEFECTS_FILE,
  CANONICAL_COMPLETED_DEFECTS_FILE,
  requireDistinctLedgerPaths,
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
  formulateBoundaryViolationHypothesis,
} from "./ledger-ops.ts";
export type { LogBoundaryViolationOptions } from "./ledger-ops.ts";

export { executeDomainTask } from "./task-runner.ts";
export { ContinuousDefectFeedbackLoop } from "./defect-loop.ts";
