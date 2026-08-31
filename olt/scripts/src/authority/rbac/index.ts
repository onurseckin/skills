export {
  verifyCommandAuthorization,
  executeShieldedCommand,
  type CommandAuthResult,
  type CommandExecResult,
  type ShieldedCommandOptions,
} from "./command-authorizer.ts";

export {
  inferActorRole,
  isAnyTestRun,
  isCoordinatorRole,
  isFileMutationCommand,
  isSupervisorOrValidatorRole,
  isUnauthorizedGitMutation,
  isWholeSuiteTestRun,
  isTestFileArgument,
  extractGitSubcommand,
} from "./command-predicates.ts";
