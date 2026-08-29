export {
  AUDIT_QUESTION_IDS,
  type AuditQuestionId,
  AUDIT_QUESTIONS,
  type AuditQuestionDefinition,
  normalizeQuestionId,
  type AuditVerdict,
  AUDIT_VERDICTS,
  type AuditAnswerVerdict,
  type AuditAnswer,
  type AuditRecord,
  type PulseGapCheckResult,
  checkPulseGaps,
  type WitnessVerificationCheckResult,
} from "./auditing/slices/group0/slice_20.ts";

export {
  checkAdmittedCandidateWitnesses,
  type CharterGoalCheckResult,
  checkAdmittedCandidateGoals,
  type ValueConsistencyCheckResult,
  checkValueConsistency,
} from "./auditing/slices/group0/slice_21.ts";

export {
  checkScopeViolations,
  type NeverUnattendedCheckResult,
  PROHIBITED_COMMAND_PATTERNS,
  checkNeverUnattendedActions,
  type DeclinedCandidateCheckResult,
  checkDeclinedCandidates,
  type CharterDigestCheckResult,
  checkCharterDigestIntegrity,
} from "./auditing/slices/group0/slice_22.ts";

export {
  validateAuditAnswers,
  type AuditBlockCheckResult,
  checkAuditBlocksPulse,
  assertAuditAllowsPulseOpen,
} from "./auditing/slices/group0/slice_23.ts";

export {
  type RoleAuditSeverity,
  type RoleAuditCategory,
  type RoleAuditFinding,
  type PersonaSignature,
  type PersonaSimilarityMetrics,
  type NonDuplicateRoleSynthesisResult,
  type SynthesizeNonDuplicateRoleOptions,
  type RoleAuditOptions,
  type RoleAuditSummary,
  type RoleAuditReport,
  computePersonaSignature,
  calculatePersonaSimilarity,
  findSimilarPersonas,
} from "./auditing/slices/group0/slice_13.ts";

export { synthesizeNonDuplicatePersona } from "./auditing/slices/group0/slice_14.ts";

export {
  isOrchestratorRole,
  isCoordinatorRole,
  isImplementerRole,
  isValidatorRole,
  isMechanicValidatorRole,
  isCognitiveValidatorRole,
  PROHIBITED_COGNITIVE_TOOL_CATEGORIES,
  PROHIBITED_COGNITIVE_TOOLS,
  roleToTier,
  isFullTestSuiteCommand,
  type ZeroToleranceBoundaryInvariant,
  type RoleBoundaryViolationType,
  type RoleBoundaryAction,
  type RoleBoundaryViolation,
  type RoleBoundaryWatchdogOptions,
  type RoleBoundaryAuditResult,
} from "./auditing/slices/group0/slice_17.ts";

export {
  createRoleBoundaryWatchdog,
  verifyRoleBoundaryAction,
  auditRoleBoundaryActions,
  type ParentChildSupervisionResult,
  validateParentChildSupervision,
  assertParentChildBoundary,
} from "./auditing/slices/group0/slice_19.ts";

export { RoleBoundaryWatchdog } from "./auditing/slices/group0/slice_18.ts";
