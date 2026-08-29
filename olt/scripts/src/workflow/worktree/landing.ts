import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { findRepoRoot } from "../../core/shared/paths.ts";
import { executeLifecycleHooks } from "../../policy/index.ts";
import { currentBranch, headSha, rebaseOnto, runGit, type GitRunner } from "./git-ops.ts";
import { git } from "./git.ts";
import { cleanupTrackWorktree } from "./manager.ts";

export interface LandTrackOptions {
  trackId: string;
  repoRoot?: string | undefined;
  remote?: string | undefined;
  targetBranch?: string | undefined;
  releaseHook?: boolean | undefined;
  customHookExecutor?: ((context: Record<string, unknown>) => unknown) | undefined;
  telemetryPath?: string | undefined;
  now?: Date | undefined;
  runner?: GitRunner | undefined;
}

export interface LandTrackResult {
  success: boolean;
  trackId: string;
  commitSha: string;
  targetBranch: string;
  rebased: boolean;
  pushed: boolean;
  durationMs: number;
  telemetryRecorded: boolean;
  hookExecuted: boolean;
  cleaned: boolean;
  tornDown: boolean;
}

function resolveRepo(repoRoot?: string): string {
  if (repoRoot) return resolve(repoRoot);
  try {
    return findRepoRoot(process.cwd());
  } catch {
    return resolve(process.cwd());
  }
}

function executeLandTrack(options: LandTrackOptions): LandTrackResult {
  const startTime = Date.now();
  const repo = resolveRepo(options.repoRoot);
  const targetBranch = options.targetBranch ?? "main";
  const runner = options.runner ?? runGit;
  const worktreesRoot = join(repo, ".olt", "worktrees");
  const worktreePath = join(worktreesRoot, options.trackId);

  if (!existsSync(worktreePath)) {
    throw new HarnessError(
      "INVALID_STATE",
      `Cannot land track '${options.trackId}': worktree does not exist at '${worktreePath}'`,
    );
  }

  let rebased = false;
  if (options.remote) {
    let fetched = false;
    try {
      git(repo, ["fetch", options.remote, targetBranch], runner);
      fetched = true;
    } catch {}

    if (fetched) {
      const rebaseOutcome = rebaseOnto(worktreePath, `${options.remote}/${targetBranch}`, runner);
      if (rebaseOutcome !== null) {
        throw new HarnessError(
          "INTEGRITY",
          `Rebase onto remote branch '${options.remote}/${targetBranch}' failed with conflicts: ${rebaseOutcome.conflictPaths.join(", ")}`,
        );
      }
      rebased = true;
    } else {
      const rebaseOutcome = rebaseOnto(worktreePath, targetBranch, runner);
      if (rebaseOutcome !== null) {
        throw new HarnessError(
          "INTEGRITY",
          `Rebase onto target branch '${targetBranch}' failed with conflicts: ${rebaseOutcome.conflictPaths.join(", ")}`,
        );
      }
      rebased = true;
    }
  } else {
    const rebaseOutcome = rebaseOnto(worktreePath, targetBranch, runner);
    if (rebaseOutcome !== null) {
      throw new HarnessError(
        "INTEGRITY",
        `Rebase onto target branch '${targetBranch}' failed with conflicts: ${rebaseOutcome.conflictPaths.join(", ")}`,
      );
    }
    rebased = true;
  }

  const commitSha = headSha(worktreePath, runner);
  const activeBranch = currentBranch(repo, runner);
  if (activeBranch === targetBranch) {
    git(repo, ["merge", "--ff-only", `track/${options.trackId}`], runner);
  } else {
    git(repo, ["branch", "-f", targetBranch, commitSha], runner);
  }

  let pushed = false;
  if (options.remote) {
    try {
      git(repo, ["push", "--atomic", options.remote, `${targetBranch}:${targetBranch}`], runner);
      pushed = true;
    } catch {
      try {
        git(repo, ["push", options.remote, `${targetBranch}:${targetBranch}`], runner);
        pushed = true;
      } catch {}
    }
  }

  let hookExecuted = false;
  const shouldRunHook = options.releaseHook ?? true;
  if (shouldRunHook) {
    const hookContext: Record<string, unknown> = {
      trackId: options.trackId,
      commitSha,
      targetBranch,
      durationMs: Date.now() - startTime,
      status: "SUCCESS",
    };
    if (options.customHookExecutor) {
      options.customHookExecutor(hookContext);
      hookExecuted = true;
    } else {
      try {
        executeLifecycleHooks({
          event: "on_phase_completion",
          context: hookContext,
          repoRoot: repo,
        });
        hookExecuted = true;
      } catch {
        hookExecuted = false;
      }
    }
  }

  const durationMs = Date.now() - startTime;
  const timestamp = (options.now ?? new Date()).toISOString();
  const telemetryRecord = {
    event: "track_landed",
    trackId: options.trackId,
    commitSha,
    targetBranch,
    timestamp,
    durationMs,
  };

  const telemetryPath = options.telemetryPath ?? join(repo, ".olt", "telemetry.jsonl");
  let telemetryRecorded = false;
  try {
    mkdirSync(dirname(telemetryPath), { recursive: true });
    appendFileSync(telemetryPath, JSON.stringify(telemetryRecord) + "\n", "utf-8");
    telemetryRecorded = true;
  } catch {
    telemetryRecorded = false;
  }

  cleanupTrackWorktree({
    trackId: options.trackId,
    repoRoot: repo,
    force: true,
    deleteBranch: true,
    runner,
  });

  return {
    success: true,
    trackId: options.trackId,
    commitSha,
    targetBranch,
    rebased,
    pushed,
    durationMs,
    telemetryRecorded,
    hookExecuted,
    cleaned: true,
    tornDown: true,
  };
}

export function landTrackToMain(trackId: string): Promise<void>;
export function landTrackToMain(options: LandTrackOptions): LandTrackResult;
export function landTrackToMain(input: string | LandTrackOptions): Promise<void> | LandTrackResult {
  if (typeof input === "string") {
    return (async () => {
      executeLandTrack({
        trackId: input,
        remote: "origin",
        targetBranch: "main",
      });
    })();
  }
  return executeLandTrack(input);
}
