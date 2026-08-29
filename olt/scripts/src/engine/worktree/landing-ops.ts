import { existsSync } from "node:fs";
import { HarnessError } from "../../core/errors/index.ts";
import {
  currentBranch,
  headSha,
  rebaseOnto,
  runGit,
  stageAndCommit,
} from "../../workflow/worktree/git-ops.ts";
import { git } from "../../workflow/worktree/git.ts";
import { destroyTrackWorktree } from "../../workflow/worktree/manager.ts";
import {
  assertConventionalCommitCompliance,
  formatConventionalCommit,
} from "./conventional-commit.ts";
import type {
  LandHermeticWorktreeOptions,
  LandingResult,
  WorktreeContext,
} from "./domain-sync-types.ts";

export type { LandHermeticWorktreeOptions, LandingResult };

export async function landHermeticWorktree(
  ctx: WorktreeContext,
  options: LandHermeticWorktreeOptions = {},
): Promise<LandingResult> {
  const startTime = Date.now();
  const runner = options.runner ?? runGit;
  const targetBranch = options.targetBranch ?? ctx.baseBranch ?? "main";
  const remote = options.remote ?? "origin";
  if (!existsSync(ctx.worktreePath)) {
    throw new HarnessError(
      "INVALID_STATE",
      `Worktree does not exist at '${ctx.worktreePath}' for track '${ctx.trackId}'`,
    );
  }

  let commitSha = "";
  if (options.commitMessage || options.description) {
    const msg =
      options.commitMessage ??
      formatConventionalCommit({
        type: options.commitType ?? "feat",
        scope: options.scope ?? ctx.trackId,
        description: options.description ?? `complete changes for track ${ctx.trackId}`,
      });
    assertConventionalCommitCompliance(msg);
    const staged = stageAndCommit(ctx.worktreePath, ["."], msg, runner);
    if (staged) commitSha = staged;
  }
  if (!commitSha) commitSha = headSha(ctx.worktreePath, runner);

  let rebased = false;
  let fetched = false;
  if (remote) {
    try {
      git(ctx.repoRoot, ["fetch", remote, targetBranch], runner);
      fetched = true;
    } catch {}
    const outcome = fetched
      ? rebaseOnto(ctx.worktreePath, `${remote}/${targetBranch}`, runner)
      : rebaseOnto(ctx.worktreePath, targetBranch, runner);
    if (outcome !== null) {
      throw new HarnessError(
        "INTEGRITY",
        `Rebase failed with conflicts: ${outcome.conflictPaths.join(", ")}`,
      );
    }
    rebased = true;
  }

  const updatedSha = headSha(ctx.worktreePath, runner);
  const activeBranch = currentBranch(ctx.repoRoot, runner);
  if (activeBranch === targetBranch) {
    git(ctx.repoRoot, ["merge", "--ff-only", ctx.branch], runner);
  } else {
    git(ctx.repoRoot, ["branch", "-f", targetBranch, updatedSha], runner);
  }

  let pushed = false;
  if (remote) {
    try {
      git(ctx.repoRoot, ["push", "--atomic", remote, `${targetBranch}:${targetBranch}`], runner);
      pushed = true;
    } catch {
      try {
        git(ctx.repoRoot, ["push", remote, `${targetBranch}:${targetBranch}`], runner);
        pushed = true;
      } catch {}
    }
  }

  destroyTrackWorktree({
    trackId: ctx.trackId,
    repoRoot: ctx.repoRoot,
    force: true,
    deleteBranch: true,
    runner,
  });

  return {
    success: true,
    trackId: ctx.trackId,
    commitSha: updatedSha,
    targetBranch,
    rebased,
    pushed,
    durationMs: Date.now() - startTime,
    cleaned: true,
    tornDown: true,
  };
}
