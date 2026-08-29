export type { AuthorizationResult, TestRunnerSpec } from "./constants.ts";
export {
  FORBIDDEN_SUBSHELL_AND_EVAL_PATTERNS,
  KNOWN_TEST_RUNNERS,
  STATIC_IMPLEMENTER_FORBIDDEN_PATTERNS,
  STATIC_SUPERVISOR_FORBIDDEN_PATTERNS,
} from "./constants.ts";

export type { CommandDispatch, GitDispatchCheck } from "./command-dispatch.ts";
export {
  analyzeCommandDispatch,
  inspectGitDispatch,
  isEnvironmentAssignment,
  isOutputWritingGitOption,
  normalizeDispatchTokens,
  normalizeExecutable,
} from "./command-dispatch.ts";

export type { SubshellDetectionResult } from "./subshell-check.ts";
export { hasUnshieldedSubshellOrChaining } from "./subshell-check.ts";

export {
  isKnownTestRunner,
  isTargetTestArgument,
  isUntargetedTestCommand,
} from "./test-runners.ts";

export { compileEffectiveForbiddenPatterns } from "./pattern-compiler.ts";

export type { ActorInput } from "./authorizer.ts";
export { verifyCommandAuthorization } from "./authorizer.ts";
