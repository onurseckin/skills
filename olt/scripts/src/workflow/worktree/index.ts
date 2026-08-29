export { assignWorktrees, type AssignableTask } from "./assign.ts";
export {
  commitSubphase,
  recordWorktreeCommit,
  type CommitSubphaseInput,
  type CommitSubphaseOutcome,
} from "./commit.ts";
export {
  consolidateWorktrees,
  recordConsolidation,
  reclaimOrphanedWorktrees,
  recordReclaim,
  type ConsolidateWorktreesInput,
  type ReclaimWorktreesInput,
  type ReclaimWorktreesResult,
} from "./consolidate.ts";
export {
  headSha,
  branchExists,
  createBranch,
  addWorktree,
  addWorktreeForBranch,
  currentBranch,
  mergeBranch,
  rebaseOnto,
  removeWorktree,
  deleteBranch,
  pruneWorktrees,
  diffStat,
  stageAndCommit,
  commitChangedLines,
  type MergeOutcome,
} from "./git-ops.ts";
export {
  worktreeGitEnvironment,
  createGitRunner,
  runGit,
  git,
  type GitResult,
  type GitRunner,
  type GitSpawn,
} from "./git.ts";
export {
  WORKTREE_LEDGER_KEY,
  readWorktreeLedger,
  writeWorktreeLedger,
  findAssignedWorktree,
} from "./ledger.ts";
export {
  createTrackWorktree,
  destroyTrackWorktree,
  cleanupTrackWorktree,
  listTrackWorktrees,
  type TrackWorktreeInfo,
  type CreateWorktreeOptions,
  type CleanupWorktreeOptions,
  type ListWorktreesOptions,
} from "./manager.ts";
export { landTrackToMain, type LandTrackOptions, type LandTrackResult } from "./landing.ts";
export {
  provisionWorktrees,
  type ProvisionWorktreesConfig,
  type ProvisionWorktreesInput,
  type ProvisionWorktreesResult,
} from "./provision.ts";
