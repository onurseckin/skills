/**
 * Worktree Isolation & Zero-Destructive Defense Facade.
 */
export {
  assertZeroDestructiveGit,
  isDestructiveGitCommand,
  assertNonDestructiveWriteScope,
  isPathInWriteScope,
  partitionObservedChanges,
  buildInclusiveStageArgs,
  filterPathsToScope,
} from "../../../olt/scripts/src/engine/worktree/zero-destructive-policy.ts";

export {
  createGitRunner,
  worktreeGitEnvironment,
  type GitRunner,
  type GitSpawn,
} from "../../../olt/scripts/src/workflow/worktree/git.ts";
