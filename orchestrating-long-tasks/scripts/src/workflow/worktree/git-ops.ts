import { HarnessError } from "../../errors/harness-error.ts";
import { git, runGit, type GitRunner } from "./git.ts";

export function headSha(repo: string, runner: GitRunner = runGit): string {
  return git(repo, ["rev-parse", "HEAD"], runner).trim();
}

export function branchExists(repo: string, branch: string, runner: GitRunner = runGit): boolean {
  return runner(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).status === 0;
}

/** A plain ref, never checked out anywhere — safe to create without touching any worktree. */
export function createBranch(repo: string, branch: string, atSha: string, runner: GitRunner = runGit): void {
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
    throw new HarnessError("INVALID_ARGUMENT", "stageAndCommit needs at least one write-scope path");
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
export function commitChangedLines(worktreePath: string, sha: string, runner: GitRunner = runGit): number {
  const output = git(worktreePath, ["show", "--shortstat", "--format=", sha], runner);
  const inserted = /(\d+) insertion/u.exec(output);
  const deleted = /(\d+) deletion/u.exec(output);
  return (inserted ? Number(inserted[1]) : 0) + (deleted ? Number(deleted[1]) : 0);
}
