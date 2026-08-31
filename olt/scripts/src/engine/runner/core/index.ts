export { portableArtifactPath, resolveArtifactPath } from "./artifact-paths.ts";

export { classifySignals, inspectFailureText, type FailureSignals } from "./classify-failure.ts";

export {
  executeInternalPreparedCommand,
  type InternalExecutionDependencies,
} from "./execute-internal-command.ts";

export { gitExecutionArgvIssues } from "./git-execution-shape.ts";

export {
  OWNERSHIP_ENV,
  addedPipeHandles,
  authenticatedOwnerPids,
  ownedProcessPids,
  ownershipTokenIdentities,
  runnerPipeHandles,
} from "./pipe-ownership.ts";

export {
  assertRunnerPlatform,
  reserveCommandRoot,
  type ReservedCommandRoot,
} from "./platform-policy.ts";

export {
  DEFAULT_TEST_IDLE_TIMEOUT_MS,
  DEFAULT_TEST_WALL_TIMEOUT_MS,
  MAX_COMMAND_ARGUMENTS,
  MAX_COMMAND_ARGV_BYTES,
  MAX_COMMAND_RETRIES,
  TEST_POLICY_DEFAULTS,
  assertCommandActor,
  assertCommandArgv,
  assertCommandIdentities,
  normalizeCommandOptions,
  policyRecord,
  policyRecordIssues,
} from "./policy.ts";

export {
  REPOSITORY_FIELDS,
  SHA256,
  repositoryObservationIssues,
  sameCommandJson,
} from "./repository-observation-shape.ts";

export {
  isGitGateCommand,
  isRestrictedGitGate,
  restrictedGateGitArgv,
} from "./restricted-git-gate.ts";

export { shouldRetry } from "./retry-policy.ts";
