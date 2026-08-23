import { spawnSync } from "node:child_process";
import { isAbsolute, join } from "node:path";
import { dispatchLifecycleHook } from "../../hooks/index.ts";
import {
  buildInclusiveStageArgs,
  formatConventionalCommitMessage,
} from "../../worktree/phase-commits.ts";

export interface AutoSyncOptions {
  taskId: string;
  label?: string | undefined;
  commitType?: string | undefined; // default "feat" or "fix"
  scope?: string | undefined;
  description: string;
  body?: string | undefined;
  writeScope: readonly string[];
  remote?: string | undefined; // default "origin"
  branch?: string | undefined; // default "main"
  skipPush?: boolean | undefined;
  skipSync?: boolean | undefined;
  repoRoot?: string | undefined;
  syncScriptPath?: string | undefined; // default "scripts/sync-global.ts"
}

export interface AutoSyncResult {
  committed: boolean;
  commitSha?: string | undefined;
  pushed: boolean;
  synced: boolean;
  message: string;
  logs: readonly string[];
}

export interface GitRunnerResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type GitRunner = (
  args: readonly string[],
  options?: { cwd?: string },
) => Promise<GitRunnerResult> | GitRunnerResult;

export interface SyncRunnerResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type SyncRunner = (
  scriptPath: string,
  options?: { cwd?: string },
) => Promise<SyncRunnerResult> | SyncRunnerResult;

function defaultGitRunner(
  args: readonly string[],
  options?: { cwd?: string },
): GitRunnerResult {
  try {
    const res = spawnSync("git", args, {
      cwd: options !== undefined ? options.cwd : undefined,
      stdio: "pipe",
      encoding: "utf8",
    });
    return {
      status: res.status !== null ? res.status : res.error ? 1 : 0,
      stdout: typeof res.stdout === "string" ? res.stdout : "",
      stderr:
        typeof res.stderr === "string"
          ? res.stderr
          : res.error !== undefined
            ? res.error.message
            : "",
    };
  } catch (err) {
    return {
      status: 1,
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
    };
  }
}

function defaultSyncRunner(
  scriptPath: string,
  options?: { cwd?: string },
): SyncRunnerResult {
  try {
    const res = spawnSync("bun", [scriptPath], {
      cwd: options !== undefined ? options.cwd : undefined,
      stdio: "pipe",
      encoding: "utf8",
    });
    return {
      status: res.status !== null ? res.status : res.error ? 1 : 0,
      stdout: typeof res.stdout === "string" ? res.stdout : "",
      stderr:
        typeof res.stderr === "string"
          ? res.stderr
          : res.error !== undefined
            ? res.error.message
            : "",
    };
  } catch (err) {
    return {
      status: 1,
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Executes per-task or subgroup Conventional Commit, Git Push, and Global Skill Sync.
 */
export async function executeAutoSyncAndCommit(
  options: AutoSyncOptions,
  gitRunner?: GitRunner,
  syncRunner?: SyncRunner,
): Promise<AutoSyncResult> {
  const runner = gitRunner !== undefined ? gitRunner : defaultGitRunner;
  const syncExec = syncRunner !== undefined ? syncRunner : defaultSyncRunner;
  const logs: string[] = [];

  const repoRoot =
    typeof options.repoRoot === "string" && options.repoRoot.length > 0
      ? options.repoRoot
      : process.cwd();
  const remote =
    typeof options.remote === "string" && options.remote.length > 0
      ? options.remote
      : "origin";
  const branch =
    typeof options.branch === "string" && options.branch.length > 0
      ? options.branch
      : "main";
  const commitType =
    typeof options.commitType === "string" && options.commitType.length > 0
      ? options.commitType
      : "feat";
  const syncScriptPath =
    typeof options.syncScriptPath === "string" && options.syncScriptPath.length > 0
      ? options.syncScriptPath
      : "scripts/sync-global.ts";

  let commitSha: string | undefined;
  let committed = false;
  let pushed = false;
  let synced = false;

  // Step 1: Format Conventional Commit message
  let formattedMessage: string;
  try {
    formattedMessage = formatConventionalCommitMessage({
      type: commitType,
      scope: options.scope,
      description: options.description,
      body: options.body,
    });
    logs.push(`[format] Conventional commit formatted: "${formattedMessage.split("\n")[0]}"`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logs.push(`[format] Commit format failed: ${errMsg}`);
    return {
      committed: false,
      commitSha: undefined,
      pushed: false,
      synced: false,
      message: options.description,
      logs,
    };
  }

  // Step 2: Stage changed files in writeScope
  try {
    if (options.writeScope && options.writeScope.length > 0) {
      const stageArgs = buildInclusiveStageArgs(options.writeScope);
      logs.push(`[stage] Running git ${stageArgs.join(" ")}`);
      const stageRes = await runner(stageArgs, { cwd: repoRoot });
      if (stageRes.status !== 0) {
        const stageErr = stageRes.stderr.length > 0 ? stageRes.stderr : stageRes.stdout;
        logs.push(`[stage] Git stage failed (status ${stageRes.status}): ${stageErr}`);
      } else {
        logs.push("[stage] Staging complete");
      }
    } else {
      logs.push("[stage] Empty write scope; skipping git add");
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logs.push(`[stage] Git stage exception: ${errMsg}`);
  }

  // Step 3: Git commit
  try {
    const commitArgs = ["commit", "-m", formattedMessage];
    logs.push(`[commit] Running git commit -m "${formattedMessage.split("\n")[0]}"`);
    const commitRes = await runner(commitArgs, { cwd: repoRoot });
    if (commitRes.status === 0) {
      committed = true;
      logs.push("[commit] Git commit succeeded");

      // Retrieve commit SHA
      const revRes = await runner(["rev-parse", "HEAD"], { cwd: repoRoot });
      if (revRes.status === 0 && revRes.stdout.trim().length > 0) {
        commitSha = revRes.stdout.trim();
        logs.push(`[commit] Resolved commit SHA: ${commitSha}`);
      }
    } else {
      committed = false;
      const commitErr = commitRes.stderr.length > 0 ? commitRes.stderr : commitRes.stdout;
      logs.push(`[commit] Git commit failed (status ${commitRes.status}): ${commitErr}`);
    }
  } catch (err) {
    committed = false;
    const errMsg = err instanceof Error ? err.message : String(err);
    logs.push(`[commit] Git commit exception: ${errMsg}`);
  }

  // Step 4: Push to remote/branch if not skipPush and commit succeeded
  if (options.skipPush) {
    logs.push("[push] Push skipped (skipPush = true)");
  } else if (!committed) {
    logs.push("[push] Push skipped because commit was not successful");
  } else {
    try {
      const pushArgs = ["push", remote, branch];
      logs.push(`[push] Running git ${pushArgs.join(" ")}`);
      const pushRes = await runner(pushArgs, { cwd: repoRoot });
      if (pushRes.status === 0) {
        pushed = true;
        logs.push(`[push] Pushed successfully to ${remote}/${branch}`);
      } else {
        pushed = false;
        const pushErr = pushRes.stderr.length > 0 ? pushRes.stderr : pushRes.stdout;
        logs.push(`[push] Git push failed (status ${pushRes.status}): ${pushErr}`);
      }
    } catch (err) {
      pushed = false;
      const errMsg = err instanceof Error ? err.message : String(err);
      logs.push(`[push] Git push exception: ${errMsg}`);
    }
  }

  // Step 5: Global skill sync if not skipSync
  if (options.skipSync) {
    logs.push("[sync] Global skill sync skipped (skipSync = true)");
  } else {
    try {
      const fullSyncScriptPath = isAbsolute(syncScriptPath)
        ? syncScriptPath
        : join(repoRoot, syncScriptPath);

      logs.push(`[sync] Running global skill sync: ${fullSyncScriptPath}`);
      const syncRes = await syncExec(fullSyncScriptPath, { cwd: repoRoot });
      if (syncRes.status === 0) {
        synced = true;
        logs.push("[sync] Global skill sync succeeded");
      } else {
        synced = false;
        const syncErr = syncRes.stderr.length > 0 ? syncRes.stderr : syncRes.stdout;
        logs.push(`[sync] Global skill sync failed (status ${syncRes.status}): ${syncErr}`);
      }
    } catch (err) {
      synced = false;
      const errMsg = err instanceof Error ? err.message : String(err);
      logs.push(`[sync] Global skill sync exception: ${errMsg}`);
    }
  }

  return {
    committed,
    commitSha,
    pushed,
    synced,
    message: formattedMessage,
    logs,
  };
}

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
 * Backward-compatible phase completion handler.
 */
export async function executePhaseCompletionSyncAndCommit(
  options: PhaseCompletionOptions,
  gitRunner?: GitRunner,
  syncRunner?: SyncRunner,
): Promise<PhaseCompletionResult> {
  const repoRoot =
    typeof options.repoRoot === "string" && options.repoRoot.length > 0
      ? options.repoRoot
      : process.cwd();
  const phaseName = options.phaseName;
  const runId = options.runId;
  const autoPush = options.autoPush !== undefined ? options.autoPush : true;

  const result = await executeAutoSyncAndCommit(
    {
      taskId: typeof runId === "string" && runId.length > 0 ? runId : phaseName,
      commitType: "feat",
      scope: "orchestrating-long-tasks",
      description: `complete ${phaseName}${typeof runId === "string" && runId.length > 0 ? ` in ${runId}` : ""}`,
      writeScope: ["."],
      skipPush: !autoPush,
      repoRoot,
    },
    gitRunner,
    syncRunner,
  );

  try {
    await dispatchLifecycleHook("phase:complete", {
      phase: phaseName,
      runId,
      synced: result.synced,
      committed: result.committed,
      pushed: result.pushed,
      commitSha: result.commitSha,
    });
  } catch {
    // Non-blocking
  }

  return {
    synced: result.synced,
    committed: result.committed,
    pushed: result.pushed,
    commitSha: result.commitSha,
  };
}
