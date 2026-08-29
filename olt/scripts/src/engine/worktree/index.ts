export {
  type DestructiveCheckOutcome,
  isDestructiveGitCommand,
  assertZeroDestructiveGit,
  isPathInWriteScope,
  filterPathsToScope,
  assertNonDestructiveWriteScope,
  buildInclusiveStageArgs,
  partitionObservedChanges,
} from "./zero-destructive-policy.ts";

export {
  CONVENTIONAL_COMMIT_TYPES,
  type CreateHermeticWorktreeOptions,
  type LandHermeticWorktreeOptions,
  type LandingResult,
  type WorktreeContext,
  type DomainWorktreeConfig,
  type DomainCommitRecord,
  type DomainSyncConflict,
  type DomainSyncResult,
  type GlobalSyncSummary,
  type DomainLedgerState,
  type DomainCommitPushInput,
  type DomainCommitPushOutcome,
  type SyncDomainInput,
  type SyncGlobalToDomainInput,
  type SyncAllDomainsInput,
  type DomainScopeEntry,
  type DomainScopeConflict,
  type DomainIsolationCheckResult,
  recordDomainCommit,
  recordDomainSync,
  recordGlobalSync,
} from "./domain-sync-types.ts";

export {
  createDomainLedger,
  createHermeticWorktree,
  provisionDomainWorktree,
  commitAndPushDomainSubphase,
  validateDomainIsolation,
  assertDomainIsolation,
  isDomainSyncEligible,
} from "./domain-sync.ts";

export {
  landHermeticWorktree,
  syncDomainToGlobal,
  syncGlobalToDomain,
  synchronizeAllDomains,
} from "./domain-sync-ops.ts";

export {
  type UpstreamPushPolicy,
  type PhaseCommitConfig,
  type ConventionalCommitMessage,
  type PhaseGateResult,
  type PhaseVerificationResult,
  type PhaseCommitPayload,
  type FormatConventionalCommitInput,
  type CommitValidationResult,
  type PushEvaluationResult,
  type VerifyPhasePreconditionsOptions,
  type CreatePhaseCommitPayloadOptions,
  formatConventionalCommit,
  formatConventionalCommitMessage,
  validatePhaseCommitMessage,
  assertConventionalCommitCompliance,
  verifyPhasePreconditions,
  createPhaseCommitPayload,
  evaluateUpstreamPushPolicy,
} from "./phase-commits.ts";

export {
  worktreeGitEnvironment,
  type GitResult,
  type GitRunner,
  type GitSpawn,
  createGitRunner,
  runGit,
  git,
} from "../../workflow/worktree/git.ts";

export {
  headSha,
  branchExists,
  createBranch,
  addWorktree,
  addWorktreeForBranch,
  currentBranch,
  type MergeOutcome,
  mergeBranch,
  rebaseOnto,
  removeWorktree,
  deleteBranch,
  pruneWorktrees,
  diffStat,
  stageAndCommit,
  commitChangedLines,
} from "../../workflow/worktree/git-ops.ts";

export {
  type CommitSubphaseInput,
  type CommitSubphaseOutcome,
  commitSubphase,
  recordWorktreeCommit,
} from "../../workflow/worktree/commit.ts";

export {
  type ConsolidateWorktreesInput,
  type ReclaimWorktreesInput,
  type ReclaimWorktreesResult,
  consolidateWorktrees,
  recordConsolidation,
  reclaimOrphanedWorktrees,
  recordReclaim,
} from "../../workflow/worktree/consolidate.ts";

export {
  type ProvisionWorktreesConfig,
  type ProvisionWorktreesInput,
  type ProvisionWorktreesResult,
  provisionWorktrees,
} from "../../workflow/worktree/provision.ts";

export { type AssignableTask, assignWorktrees } from "../../workflow/worktree/assign.ts";

export {
  WORKTREE_LEDGER_KEY,
  readWorktreeLedger,
  writeWorktreeLedger,
  findAssignedWorktree,
} from "../../workflow/worktree/ledger.ts";

export {
  createTrackWorktree,
  destroyTrackWorktree,
  cleanupTrackWorktree,
  listTrackWorktrees,
  type TrackWorktreeInfo,
  type CreateWorktreeOptions,
  type CleanupWorktreeOptions,
  type ListWorktreesOptions,
} from "../../workflow/worktree/manager.ts";

export {
  landTrackToMain,
  type LandTrackOptions,
  type LandTrackResult,
} from "../../workflow/worktree/landing.ts";
