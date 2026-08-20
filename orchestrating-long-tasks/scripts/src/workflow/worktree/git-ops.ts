import { HarnessError } from "../../errors/harness-error.ts";
import { git, runGit, type GitRunner } from "./git.ts";

// Re-exported so callers needing a default runner (reclaim.ts, consolidate.ts) can get both the
// type and the default implementation from this module instead of reaching past it to git.ts.
export { runGit };
export type { GitRunner };

export function headSha(repo: string, runner: GitRunner = runGit): string {
  return git(repo, ["rev-parse", "HEAD"], runner).trim();
}

export function branchExists(repo: string, branch: string, runner: GitRunner = runGit): boolean {
  return runner(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).status === 0;
}

/** A plain ref, never checked out anywhere — safe to create without touching any worktree. */
export function createBranch(
  repo: string,
  branch: string,
  atSha: string,
  runner: GitRunner = runGit,
): void {
  git(repo, ["branch", branch, atSha], runner);
}

export function addWorktree(
  repo: string,
  worktreePath: string,
  branch: string,
  atSha: string,
  runner: GitRunner = runGit,
): void {
  git(repo, ["worktree", "add", "-b", branch, worktreePath, atSha], runner);
}

/** Checks out an EXISTING branch into a new worktree, unlike `addWorktree` which creates one. The
 *  one legitimate caller is B22.4 consolidation, checking out the shared `harness_branch` into a
 *  scratch worktree of its own so the merge/rebase has somewhere to run without touching the user's
 *  working tree or any per-task worktree. */
export function addWorktreeForBranch(
  repo: string,
  worktreePath: string,
  branch: string,
  runner: GitRunner = runGit,
): void {
  git(repo, ["worktree", "add", worktreePath, branch], runner);
}

/** The branch HEAD is on, or `null` for detached HEAD — there is nothing B22.4 can rebase onto in
 *  that case, so provisioning records the absence rather than a branch name that was never true. */
export function currentBranch(repo: string, runner: GitRunner = runGit): string | null {
  const result = runner(repo, ["symbolic-ref", "--short", "-q", "HEAD"]);
  if (result.status !== 0) return null;
  const name = result.stdout.trim();
  return name === "" ? null : name;
}

/** Every path a `git merge` or `git rebase` left in a conflicted (unmerged) state, read while the
 *  operation is still mid-flight — the caller aborts right after, so this is the only chance to see
 *  which paths actually collided rather than reporting the fact of a conflict with nothing to act on. */
function conflictedPaths(worktreePath: string, runner: GitRunner): string[] {
  const result = runner(worktreePath, ["diff", "--name-only", "--diff-filter=U"]);
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export interface MergeOutcome {
  conflictPaths: string[];
}

/**
 * Merges `branch` into whatever the worktree at `worktreePath` has checked out. A clean merge
 * returns `null`; a conflict aborts the merge (restoring the pre-merge tree, same as the rebase
 * path below) and returns the paths that collided — B22.4 treats this the same as a rebase
 * conflict: STOP, leave the branch as it was, report the paths, never resolve on the user's behalf.
 */
export function mergeBranch(
  worktreePath: string,
  branch: string,
  message: string,
  runner: GitRunner = runGit,
): MergeOutcome | null {
  const result = runner(worktreePath, ["merge", "--no-ff", "-m", message, branch]);
  if (result.status === 0) return null;
  const paths = conflictedPaths(worktreePath, runner);
  runner(worktreePath, ["merge", "--abort"]);
  if (paths.length === 0) {
    // A merge failure that left nothing conflicted (bad ref, dirty tree) is not the conflict case
    // this function exists to report — propagate it as the real git error it is.
    throw new HarnessError(
      "INTEGRITY",
      `git merge --no-ff ${branch} exited ${result.status}: ${result.stderr.trim() || "no conflicted paths found"}`,
    );
  }
  return { conflictPaths: paths };
}

/**
 * Rebases the worktree at `worktreePath` onto `ontoBranch`. `null` on a clean rebase; the
 * conflicting paths on a conflict, after aborting back to the pre-rebase state — same contract as
 * `mergeBranch`.
 */
export function rebaseOnto(
  worktreePath: string,
  ontoBranch: string,
  runner: GitRunner = runGit,
): MergeOutcome | null {
  const result = runner(worktreePath, ["rebase", ontoBranch]);
  if (result.status === 0) return null;
  const paths = conflictedPaths(worktreePath, runner);
  runner(worktreePath, ["rebase", "--abort"]);
  if (paths.length === 0) {
    throw new HarnessError(
      "INTEGRITY",
      `git rebase ${ontoBranch} exited ${result.status}: ${result.stderr.trim() || "no conflicted paths found"}`,
    );
  }
  return { conflictPaths: paths };
}

/** `--force` here discards nothing this codebase committed — every sub-phase commit already lives
 *  in the worktree's own branch before removal is ever called, so any uncommitted leftover a
 *  removed worktree is carrying was abandoned scratch state, not recorded work. */
export function removeWorktree(
  repo: string,
  worktreePath: string,
  runner: GitRunner = runGit,
): void {
  git(repo, ["worktree", "remove", "--force", worktreePath], runner);
}

export function deleteBranch(repo: string, branch: string, runner: GitRunner = runGit): void {
  git(repo, ["branch", "-D", branch], runner);
}

/** Clears git's own `.git/worktrees/<id>` administrative entries left behind when a worktree
 *  directory was removed some other way than `git worktree remove` (a human `rm -rf`'d it, say) —
 *  B22.6's reclaim runs this after its own removals so neither path leaves git's metadata stale. */
export function pruneWorktrees(repo: string, runner: GitRunner = runGit): void {
  git(repo, ["worktree", "prune"], runner);
}

/** Insertions + deletions + files touched, from `git diff --stat`'s own final summary line — the
 *  human-readable form B22.4.5 asks the completion report to carry. `git diff --stat` prints
 *  nothing at all when the two refs are identical, which is the one case "0 files changed" is a
 *  verified fact rather than an invented one; any other output always ends in that summary line, so
 *  there is nothing left to fall back to guessing. */
export function diffStat(
  worktreePath: string,
  fromRef: string,
  toRef: string,
  runner: GitRunner = runGit,
): string {
  const output = git(worktreePath, ["diff", "--stat", `${fromRef}..${toRef}`], runner).trim();
  if (output === "") return "0 files changed";
  const lines = output.split("\n");
  return lines[lines.length - 1]!.trim();
}

/**
 * Stages exactly the task's write scope inside its worktree and commits if anything is actually
 * staged. Returns `null` when nothing changed — a task that reported completion without touching
 * its own scope is not an error here, just nothing to commit (B22.3 is silent on this case; refusing
 * would make an honest no-op submission fail for a reason unrelated to the task itself).
 */
export function stageAndCommit(
  worktreePath: string,
  pathspecs: readonly string[],
  subject: string,
  runner: GitRunner = runGit,
): string | null {
  if (pathspecs.length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "stageAndCommit needs at least one write-scope path",
    );
  }
  const added = runner(worktreePath, ["add", "--", ...pathspecs]);
  if (added.status !== 0) {
    // A write scope naming a path this task never actually created (or never touched) is a
    // legitimate no-op, not a failure — `git add` on a wholly nonexistent pathspec is the one
    // failure mode this treats as "nothing to stage" rather than propagating it; anything else
    // (a real git error) still throws.
    if (/did not match any files/u.test(added.stderr)) return null;
    throw new HarnessError(
      "INTEGRITY",
      `git add -- ${pathspecs.join(" ")} exited ${added.status}: ${added.stderr.trim()}`,
    );
  }
  const staged = runner(worktreePath, ["diff", "--cached", "--quiet"]);
  if (staged.status === 0) return null;
  git(worktreePath, ["commit", "-m", subject], runner);
  return headSha(worktreePath, runner);
}

/** Insertions + deletions for one commit against its sole parent, from `git`'s own summary line. */
export function commitChangedLines(
  worktreePath: string,
  sha: string,
  runner: GitRunner = runGit,
): number {
  const output = git(worktreePath, ["show", "--shortstat", "--format=", sha], runner);
  const inserted = /(\d+) insertion/u.exec(output);
  const deleted = /(\d+) deletion/u.exec(output);
  return (inserted ? Number(inserted[1]) : 0) + (deleted ? Number(deleted[1]) : 0);
}
