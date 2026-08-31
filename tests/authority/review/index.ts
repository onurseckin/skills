/**
 * Authority Review Subdomain Test Facade.
 * Explicit named exports for review pushback, superficial claim rejection, domain batching, and multi-round histories.
 */

export {
  SUPERFICIAL_PATTERNS,
  rejectSuperficialClaims,
  detectDomainBatching,
  evaluateCounterfactualEvidence,
  auditTaskVerificationEvidence,
  createPushbackHistory,
  appendPushbackRound,
  evaluateRepairProgression,
  isRepairExhausted,
  generateCorrectiveGuidance,
  validateReviewPushbackInput,
  validateReviewPushbackCriteria,
  type TaskVerificationEvidenceInput,
  type TaskVerificationCheckInput,
  type CounterfactualEvidenceItem,
  type PushbackRound,
  type PushbackHistory,
} from "../../../olt/scripts/src/authority/review/index.ts";
