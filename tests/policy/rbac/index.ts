export {
  compileEffectiveForbiddenPatterns,
  isTargetTestArgument,
  isUntargetedTestCommand,
  hasUnshieldedSubshellOrChaining,
  isCommandAuthorizedForRole,
  isActionAllowedForRole,
  FORBIDDEN_SUPERVISOR_PATTERNS,
  FORBIDDEN_COGNITIVE_VALIDATOR_PATTERNS,
  FORBIDDEN_IMPLEMENTER_PATTERNS,
} from "../../../olt/scripts/src/policy/rbac/index.ts";
export type {
  Role,
  ActionType,
  RBACDecision,
  RBACVerificationResult,
  EffectiveForbiddenRules,
} from "../../../olt/scripts/src/policy/rbac/types.ts";
export {
  mockRolePolicies,
} from "./fixtures.ts";
