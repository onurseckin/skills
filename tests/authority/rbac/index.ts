/**
 * Authority RBAC Subdomain Test Facade.
 * Explicit named exports for command authorization, shielded shell, owner role, and supervisory confinement.
 */

export {
  verifyCommandAuthorization,
  executeShieldedCommand,
  isWholeSuiteTestCommand,
  isUnauthorizedGitMutation,
  isPermittedCliTool,
  isShieldedMutationCommand,
  inferRoleFromActorId,
} from "../../../olt/scripts/src/authority/rbac/index.ts";

export {
  evaluateSupervisoryState,
  constructSupervisoryPersonaReminder,
  computeScopeOverlaps,
  parseTimeMs,
  STANDING_CHECKLIST_DEFINITIONS,
  DECISION_PROTOCOLS,
} from "../../../olt/scripts/src/authority/supervisory/index.ts";

export {
  type SupervisoryReminderEvaluationContext,
  type SupervisoryEvaluationResult,
  type SupervisoryPersonaReminder,
  type SupervisoryViolation,
  type ScopeOverlap,
} from "../../../olt/scripts/src/authority/supervisory/types.ts";
