export type {
  CounterfactualEvidenceEvaluation,
  CounterfactualEvidenceItem,
  DomainBatchingDetectionResult,
  PushbackHistory,
  PushbackRoundRecord,
  RepairProgressionEvaluation,
  ScepticismAuditOptions,
  ScepticismViolation,
  ScepticismViolationType,
  SuperficialityDetectionResult,
  TaskVerificationAuditResult,
  TaskVerificationCheckInput,
  TaskVerificationEvidenceInput,
  TaskVerificationEvidenceItem,
  ValidatedReviewPushback,
} from "./types.ts";

export { SUPERFICIAL_PATTERNS } from "./constants.ts";

export {
  detectDomainBatching,
  evaluateCounterfactualEvidence,
  evaluateRepairProgression,
  isRepairExhausted,
  rejectSuperficialClaims,
} from "./evaluators.ts";

export { auditTaskVerificationEvidence, generateCorrectiveGuidance } from "./audit.ts";

export { appendPushbackRound, createPushbackHistory } from "./history.ts";

export { validateReviewPushbackCriteria, validateReviewPushbackInput } from "./validation.ts";
