export {
  compileEffectiveForbiddenPatterns,
  isTargetTestArgument,
  isUntargetedTestCommand,
  hasUnshieldedSubshellOrChaining,
  verifyCommandAuthorization,
  FORBIDDEN_SUBSHELL_AND_EVAL_PATTERNS,
  STATIC_SUPERVISOR_FORBIDDEN_PATTERNS,
  STATIC_IMPLEMENTER_FORBIDDEN_PATTERNS,
} from "../../../olt/scripts/src/policy/rbac/index.ts";
export type {
  AuthorizationResult,
  TestRunnerSpec,
  ActorInput,
  CommandDispatch,
  SubshellDetectionResult,
} from "../../../olt/scripts/src/policy/rbac/index.ts";
export { samplePolicy, createActor } from "./fixtures.ts";
