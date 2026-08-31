import { enforceLineLimit } from "../../cli/formatters/line-limiter.ts";
import { HarnessError } from "../../core/errors/index.ts";
import {
  assessRecyclingState,
  type RecycleAssessment,
} from "../../mind/archival/recycler/index.ts";
import { loadRun } from "../../engine/store/index.ts";
import { defaultGitRunner, defaultSyncRunner, boundedEvidenceCause } from "./runners.ts";
import { enforceZeroMainThreadSpillover } from "./spillover-guard.ts";
import type {
  BackgroundFinalizationOptions,
  BackgroundFinalizationResult,
  FinalizationStepResult,
  ZeroMainThreadSpilloverVerification,
} from "./types.ts";

export function formatBackgroundFinalizationBrief(input: {
  readonly runId?: string | undefined;
  readonly actor: string;
  readonly committed: boolean;
  readonly pushed: boolean;
  readonly synced: boolean;
  readonly commitSha?: string | undefined;
  readonly durationMs: number;
  readonly spilloverVerification: ZeroMainThreadSpilloverVerification;
  readonly recyclingAssessment?: RecycleAssessment | undefined;
  readonly success: boolean;
  readonly error?: string | undefined;
}): string {
  const commitStatusText = input.committed
    ? `✓ Committed (${input.commitSha ?? "unrecorded"})`
    : "○ Skipped/Clean";
  const lines = [
    "### Tier 1 Background Orchestrator Finalization",
    input.runId !== undefined ? `- **Run ID**: \`${input.runId}\`` : undefined,
    `- **Status**: ${input.success ? "✓ Completed" : "✗ Failed"}`,
    `- **Actor**: \`${input.actor}\` (Tier ${input.spilloverVerification.executionTier} Background Orchestrator)`,
    `- **Zero Main-Thread Spillover**: ${input.spilloverVerification.compliant ? "✓ Verified (0 spillover)" : "✗ Violated"}`,
    `- **Git Commit**: ${commitStatusText}`,
    `- **Git Push**: ${input.pushed ? "✓ Pushed to upstream" : "○ Skipped"}`,
    `- **Global Sync**: ${input.synced ? "✓ Synced (`~/.agents/skills`)" : "○ Skipped"}`,
    `- **Duration**: ${(input.durationMs / 1000).toFixed(2)}s`,
    input.error !== undefined ? `- **Error**: ${input.error}` : undefined,
    input.recyclingAssessment !== undefined
      ? `- **Autonomous Recycling**: \`${input.recyclingAssessment.transition}\` -> \`${input.recyclingAssessment.nextRecommendedCommand}\``
      : undefined,
  ].filter((l): l is string => l !== undefined);

  return enforceLineLimit(lines.join("\n"), 25);
}

export async function executeBackgroundFinalization(
  options: BackgroundFinalizationOptions,
): Promise<BackgroundFinalizationResult> {
  const startTime = Date.now();
  const repoPath = options.repoPath.trim();
  if (repoPath.length === 0)
    throw new HarnessError("INVALID_ARGUMENT", "repoPath is required for background finalization");

  const isMainThread = options.isMainThread ?? false;
  const executionTier = options.executionTier ?? 1;
  const actor = options.actor?.length ? options.actor : "orchestrator-tier1";
  const runId = options.runId;
  const runRoot = options.runRoot;
  const gitRunner = options.gitRunner ?? defaultGitRunner;
  const syncRunner = options.syncRunner ?? defaultSyncRunner;
  const skipPush = options.skipPush ?? false;
  const skipSync = options.skipSync ?? false;
  const syncCommand = options.syncCommand?.length
    ? options.syncCommand
    : "bun scripts/sync/index.ts";
  const commitMessage = options.commitMessage?.length
    ? options.commitMessage
    : runId !== undefined
      ? `feat(orchestrator): autonomous convergence finalization [${runId}]`
      : "feat(orchestrator): autonomous convergence finalization";
  const branch = options.branch?.length ? options.branch : "main";
  const remote = options.remote?.length ? options.remote : "origin";
  const now =
    options.now !== undefined
      ? new Date(options.now).toISOString()
      : new Date(startTime).toISOString();

  if (isMainThread)
    throw new HarnessError(
      "INTEGRITY",
      "Zero Main-Thread Spillover violation: background finalization cannot be executed from interactive main thread",
    );
  if (executionTier !== 1 && executionTier !== 0)
    throw new HarnessError(
      "INTEGRITY",
      `Zero Main-Thread Spillover violation: finalization must execute in Tier 1 Orchestrator thread (current: ${executionTier})`,
    );

  const steps: FinalizationStepResult[] = [];
  let committed = false;
  let pushed = false;
  let synced = false;
  let commitSha: string | undefined;
  let overallSuccess = true;
  let firstError: string | undefined;

  // 1. git add
  const addStart = Date.now();
  const addResult = await Promise.resolve(gitRunner(["add", "-A"], repoPath));
  const addDuration = Date.now() - addStart;
  if (addResult.status === 0) {
    steps.push({
      step: "git_add",
      executed: true,
      status: "success",
      command: "git add -A",
      stdout: addResult.stdout,
      stderr: addResult.stderr,
      exitCode: addResult.status,
      durationMs: addDuration,
    });
  } else {
    overallSuccess = false;
    firstError = `git add failed: ${addResult.stderr || addResult.stdout}`;
    steps.push({
      step: "git_add",
      executed: true,
      status: "failed",
      command: "git add -A",
      stdout: addResult.stdout,
      stderr: addResult.stderr,
      exitCode: addResult.status,
      durationMs: addDuration,
      reason: firstError,
    });
  }

  // 2. git status
  const statusStart = Date.now();
  const statusResult = await Promise.resolve(gitRunner(["status", "--porcelain"], repoPath));
  const statusDuration = Date.now() - statusStart;
  const hasStagedChanges = statusResult.status === 0 && statusResult.stdout.trim().length > 0;
  steps.push({
    step: "git_status",
    executed: true,
    status: statusResult.status === 0 ? "success" : "failed",
    command: "git status --porcelain",
    stdout: statusResult.stdout,
    stderr: statusResult.stderr,
    exitCode: statusResult.status,
    durationMs: statusDuration,
  });

  // 3. git commit
  const commitStart = Date.now();
  if (hasStagedChanges && overallSuccess) {
    const commitResult = await Promise.resolve(
      gitRunner(["commit", "-m", commitMessage], repoPath),
    );
    const commitDuration = Date.now() - commitStart;
    if (commitResult.status === 0) {
      committed = true;
      const shaResult = await Promise.resolve(gitRunner(["rev-parse", "HEAD"], repoPath));
      commitSha = shaResult.status === 0 ? shaResult.stdout.trim() : undefined;
      steps.push({
        step: "git_commit",
        executed: true,
        status: "success",
        command: `git commit -m "${commitMessage}"`,
        stdout: commitResult.stdout,
        stderr: commitResult.stderr,
        exitCode: commitResult.status,
        durationMs: commitDuration,
      });
    } else {
      overallSuccess = false;
      firstError = `git commit failed: ${commitResult.stderr || commitResult.stdout}`;
      steps.push({
        step: "git_commit",
        executed: true,
        status: "failed",
        command: `git commit -m "${commitMessage}"`,
        stdout: commitResult.stdout,
        stderr: commitResult.stderr,
        exitCode: commitResult.status,
        durationMs: commitDuration,
        reason: firstError,
      });
    }
  } else {
    steps.push({
      step: "git_commit",
      executed: false,
      status: "skipped",
      command: `git commit -m "${commitMessage}"`,
      durationMs: Date.now() - commitStart,
      reason: hasStagedChanges ? "skipped_due_to_prior_failure" : "clean_working_tree_no_changes",
    });
  }

  // 4. git push
  const pushStart = Date.now();
  if (!skipPush && overallSuccess) {
    const pushResult = await Promise.resolve(gitRunner(["push", remote, branch], repoPath));
    const pushDuration = Date.now() - pushStart;
    if (pushResult.status === 0) {
      pushed = true;
      steps.push({
        step: "git_push",
        executed: true,
        status: "success",
        command: `git push ${remote} ${branch}`,
        stdout: pushResult.stdout,
        stderr: pushResult.stderr,
        exitCode: pushResult.status,
        durationMs: pushDuration,
      });
    } else {
      overallSuccess = false;
      firstError = `git push failed: ${pushResult.stderr || pushResult.stdout}`;
      steps.push({
        step: "git_push",
        executed: true,
        status: "failed",
        command: `git push ${remote} ${branch}`,
        stdout: pushResult.stdout,
        stderr: pushResult.stderr,
        exitCode: pushResult.status,
        durationMs: pushDuration,
        reason: firstError,
      });
    }
  } else {
    steps.push({
      step: "git_push",
      executed: false,
      status: "skipped",
      command: `git push ${remote} ${branch}`,
      durationMs: Date.now() - pushStart,
      reason: skipPush ? "push_disabled_by_config" : "skipped_due_to_prior_failure",
    });
  }

  // 5. global sync
  const syncStart = Date.now();
  if (!skipSync && overallSuccess) {
    const syncResult = await Promise.resolve(syncRunner(syncCommand, repoPath));
    const syncDuration = Date.now() - syncStart;
    if (syncResult.status === 0) {
      synced = true;
      steps.push({
        step: "global_sync",
        executed: true,
        status: "success",
        command: syncCommand,
        stdout: syncResult.stdout,
        stderr: syncResult.stderr,
        exitCode: syncResult.status,
        durationMs: syncDuration,
      });
    } else {
      overallSuccess = false;
      firstError = `global sync failed: ${syncResult.stderr || syncResult.stdout}`;
      steps.push({
        step: "global_sync",
        executed: true,
        status: "failed",
        command: syncCommand,
        stdout: syncResult.stdout,
        stderr: syncResult.stderr,
        exitCode: syncResult.status,
        durationMs: syncDuration,
        reason: firstError,
      });
    }
  } else {
    steps.push({
      step: "global_sync",
      executed: false,
      status: "skipped",
      command: syncCommand,
      durationMs: Date.now() - syncStart,
      reason: skipSync ? "sync_disabled_by_config" : "skipped_due_to_prior_failure",
    });
  }

  const spilloverVerification = enforceZeroMainThreadSpillover({
    executionTier,
    isMainThread,
    finalizationComplete: overallSuccess,
    gitOperationsEnclosed: true,
    globalSyncEnclosed: !skipSync,
  });

  let recyclingAssessment: RecycleAssessment | undefined;
  if (runRoot !== undefined || options.state !== undefined) {
    try {
      const stateToAssess =
        options.state ?? (runRoot !== undefined ? loadRun(runRoot).state : undefined);
      if (stateToAssess !== undefined) {
        recyclingAssessment = assessRecyclingState(stateToAssess, runRoot ?? repoPath, { now });
      }
    } catch (error) {
      overallSuccess = false;
      firstError ??= `recycling assessment unavailable: ${boundedEvidenceCause(error)}`;
    }
  }

  const durationMs = Date.now() - startTime;
  const markdown = formatBackgroundFinalizationBrief({
    runId,
    actor,
    committed,
    pushed,
    synced,
    commitSha,
    durationMs,
    spilloverVerification,
    recyclingAssessment,
    success: overallSuccess,
    error: firstError,
  });

  if (options.throwOnError === true && !overallSuccess)
    throw new HarnessError("INTEGRITY", firstError ?? "Background finalization failed");

  return {
    success: overallSuccess,
    actor,
    repoPath,
    runId,
    runRoot,
    executedAt: now,
    durationMs,
    steps,
    committed,
    pushed,
    synced,
    commitSha,
    zeroMainThreadSpillover: true,
    spilloverVerification,
    recyclingAssessment,
    markdown,
    error: firstError,
  };
}
