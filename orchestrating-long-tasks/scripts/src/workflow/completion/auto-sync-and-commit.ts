import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { dispatchLifecycleHook } from "../../hooks/index.ts";

export interface PhaseCompletionResult {
  readonly synced: boolean;
  readonly committed: boolean;
  readonly pushed: boolean;
  readonly commitSha?: string | undefined;
  readonly error?: string | undefined;
}

export interface PhaseCompletionOptions {
  readonly phaseName: string;
  readonly runId?: string | undefined;
  readonly repoRoot?: string | undefined;
  readonly autoPush?: boolean | undefined;
}

/**
 * Automatically syncs the local skill globally, commits changes with Conventional Commits,
 * and pushes to the remote tracking branch upon phase or run completion.
 */
export async function executePhaseCompletionSyncAndCommit(
  options: PhaseCompletionOptions,
): Promise<PhaseCompletionResult> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const phaseName = options.phaseName;
  const runId = options.runId;
  const autoPush = options.autoPush ?? true;

  let synced = false;
  let committed = false;
  let pushed = false;
  let commitSha: string | undefined;

  // 1. Run local skill sync
  const syncScript = join(repoRoot, "scripts", "sync-global.ts");
  if (existsSync(syncScript)) {
    try {
      const syncRes = spawnSync("bun", [syncScript], {
        cwd: repoRoot,
        stdio: "pipe",
        encoding: "utf8",
        timeout: 15_000,
      });
      if (syncRes.status === 0) {
        synced = true;
      }
    } catch {
      synced = false;
    }
  }

  // 2. Check git status
  try {
    const statusRes = spawnSync("git", ["status", "--porcelain"], {
      cwd: repoRoot,
      stdio: "pipe",
      encoding: "utf8",
      timeout: 10_000,
    });

    const statusOutput = (statusRes.stdout ?? "").trim();
    if (statusOutput.length > 0) {
      // Stage changed files
      spawnSync("git", ["add", "-A"], {
        cwd: repoRoot,
        stdio: "pipe",
        encoding: "utf8",
        timeout: 10_000,
      });

      // Conventional commit message
      const commitSubject = `feat(orchestrating-long-tasks): complete ${phaseName}${runId ? ` in ${runId}` : ""}`;
      const commitRes = spawnSync("git", ["commit", "-m", commitSubject], {
        cwd: repoRoot,
        stdio: "pipe",
        encoding: "utf8",
        timeout: 15_000,
      });

      if (commitRes.status === 0) {
        committed = true;

        // Get latest commit sha
        const revRes = spawnSync("git", ["rev-parse", "HEAD"], {
          cwd: repoRoot,
          stdio: "pipe",
          encoding: "utf8",
        });
        if (revRes.status === 0) {
          commitSha = (revRes.stdout ?? "").trim();
        }

        // Push if enabled
        if (autoPush) {
          const pushRes = spawnSync("git", ["push"], {
            cwd: repoRoot,
            stdio: "pipe",
            encoding: "utf8",
            timeout: 30_000,
          });
          if (pushRes.status === 0) {
            pushed = true;
          }
        }
      }
    }
  } catch (err) {
    return {
      synced,
      committed,
      pushed,
      commitSha,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // 3. Dispatch lifecycle hook
  try {
    await dispatchLifecycleHook("phase:complete", {
      phase: phaseName,
      runId,
      synced,
      committed,
      pushed,
      commitSha,
    });
  } catch {
    // Non-blocking
  }

  return {
    synced,
    committed,
    pushed,
    commitSha,
  };
}
