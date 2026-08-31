/**
 * Worktree Domain Test & Logic Facades.
 * Explicit named exports - zero wildcard export *.
 */
export {
  assertZeroDestructiveGit,
  isDestructiveGitCommand,
  assertNonDestructiveWriteScope,
  isPathInWriteScope,
  partitionObservedChanges,
  buildInclusiveStageArgs,
  filterPathsToScope,
  createGitRunner,
  worktreeGitEnvironment,
  type GitRunner,
  type GitSpawn,
} from "./isolation/index.ts";

export {
  createDomainLedger,
  provisionDomainWorktree,
  commitAndPushDomainSubphase,
  syncDomainToGlobal,
  syncGlobalToDomain,
  synchronizeAllDomains,
  assertDomainIsolation,
  isDomainSyncEligible,
  recordDomainCommit,
  recordDomainSync,
  recordGlobalSync,
  validateDomainIsolation,
  type DomainCommitRecord,
  type DomainLedgerState,
  type DomainSyncResult,
  type GlobalSyncSummary,
  type ProvisionWorktreeOptions,
  type ProvisionWorktreeResult,
} from "./sync/index.ts";

export {
  CONVENTIONAL_COMMIT_TYPES,
  formatConventionalCommit,
  validatePhaseCommitMessage,
  assertConventionalCommitCompliance,
  evaluateUpstreamPushPolicy,
  type ConventionalCommitMessage,
  type ConventionalCommitType,
  type PhaseCommitValidationResult,
  type UpstreamPushPolicy,
} from "./commits/index.ts";
