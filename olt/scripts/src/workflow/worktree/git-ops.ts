import { HarnessError } from "../../core/errors/harness-error.ts";
import { git, runGit, type GitRunner } from "./git.ts";

export { runGit };
export type { GitRunner };

export function headSha(repo: string, runner: GitRunner = runGit): string {
  return git(repo, ["rev-parse", "HEAD"], runner).trim();
}

export function branchExists(repo: string, branch: string, runner: GitRunner = runGit): boolean {
  return runner(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).status === 0;
}

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

export function addWorktreeForBranch(
  repo: string,
  worktreePath: string,
  branch: string,
  runner: GitRunner = runGit,
): void {
  git(repo, ["worktree", "add", worktreePath, branch], runner);
}

export function currentBranch(repo: string, runner: GitRunner = runGit): string | null {
  const result = runner(repo, ["symbolic-ref", "--short", "-q", "HEAD"]);
  if (result.status !== 0) return null;
  const name = result.stdout.trim();
  return name === "" ? null : name;
}

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
    throw new HarnessError(
      "INTEGRITY",
      `git merge --no-ff ${branch} exited ${result.status}: ${result.stderr.trim() || "no conflicted paths found"}`,
    );
  }
  return { conflictPaths: paths };
}

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

export function pruneWorktrees(repo: string, runner: GitRunner = runGit): void {
  git(repo, ["worktree", "prune"], runner);
}

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
