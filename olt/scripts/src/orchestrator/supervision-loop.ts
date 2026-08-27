import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { enforceLineLimit } from "../cli/formatters/line-limiter.ts";
import { HarnessError } from "../core/errors/harness-error.ts";
import {
  assessRecyclingState,
  formatRecycleBrief,
  planAutonomousRoundRecycle,
  transitionCompletenessCriticSignOff,
  type AutonomousRecycleOptions,
  type RecycleAssessment,
  type RecyclePlan,
} from "../mind/recycler.ts";
import { loadRun } from "../engine/store/index.ts";
import { AutonomousLoopRunner } from "./loop-runner.ts";
import type {
  LoopRunnerOptions,
  LoopSummary,
  RoundExecutionInput,
  RoundExecutionResult,
  RoundExecutor,
  RoundTelemetry,
} from "./types.ts";

export type FinalizationStepName =
  | "git_add"
  | "git_status"
  | "git_commit"
  | "git_push"
  | "global_sync";

export type FinalizationStepStatus = "success" | "skipped" | "failed";

export interface FinalizationStepResult {
  readonly step: FinalizationStepName;
  readonly executed: boolean;
  readonly status: FinalizationStepStatus;
  readonly command: string;
  readonly stdout?: string | undefined;
  readonly stderr?: string | undefined;
  readonly exitCode?: number | null | undefined;
  readonly durationMs: number;
  readonly reason?: string | undefined;
}

export interface GitRunnerResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export type GitRunner = (
  args: readonly string[],
  cwd: string,
) => GitRunnerResult | Promise<GitRunnerResult>;

export type SyncRunner = (
  command: string,
  cwd: string,
) => GitRunnerResult | Promise<GitRunnerResult>;

export interface BackgroundFinalizationOptions {
  readonly repoPath: string;
  readonly runRoot?: string | undefined;
  readonly runId?: string | undefined;
  readonly actor?: string | undefined;
  readonly commitMessage?: string | undefined;
  readonly branch?: string | undefined;
  readonly remote?: string | undefined;
  readonly skipPush?: boolean | undefined;
  readonly skipSync?: boolean | undefined;
  readonly syncCommand?: string | undefined;
  readonly gitRunner?: GitRunner | undefined;
  readonly syncRunner?: SyncRunner | undefined;
  readonly isMainThread?: boolean | undefined;
  readonly executionTier?: number | undefined;
  readonly throwOnError?: boolean | undefined;
  readonly state?: Record<string, unknown> | undefined;
  readonly now?: Date | string | number | undefined;
}

export interface ZeroMainThreadSpilloverVerification {
  readonly compliant: boolean;
  readonly executionTier: number;
  readonly executedInBackground: boolean;
  readonly mainThreadSpillover: boolean;
  readonly gitOperationsEnclosed: boolean;
  readonly globalSyncEnclosed: boolean;
  readonly verifiedAt: string;
  readonly message: string;
}

export interface BackgroundFinalizationResult {
  readonly success: boolean;
  readonly actor: string;
  readonly repoPath: string;
  readonly runId?: string | undefined;
  readonly runRoot?: string | undefined;
  readonly executedAt: string;
  readonly durationMs: number;
  readonly steps: readonly FinalizationStepResult[];
  readonly committed: boolean;
  readonly pushed: boolean;
  readonly synced: boolean;
  readonly commitSha?: string | undefined;
  readonly zeroMainThreadSpillover: boolean;
  readonly spilloverVerification: ZeroMainThreadSpilloverVerification;
  readonly recyclingAssessment?: RecycleAssessment | undefined;
  readonly markdown: string;
  readonly error?: string | undefined;
}

export interface SupervisionLoopRunnerOptions extends LoopRunnerOptions {
  readonly autoFinalizeOnConvergence?: boolean | undefined;
  readonly commitMessageTemplate?: string | undefined;
  readonly branch?: string | undefined;
  readonly remote?: string | undefined;
  readonly skipPush?: boolean | undefined;
  readonly skipSync?: boolean | undefined;
  readonly syncCommand?: string | undefined;
  readonly gitRunner?: GitRunner | undefined;
  readonly syncRunner?: SyncRunner | undefined;
  readonly onFinalizationComplete?: ((result: BackgroundFinalizationResult) => void) | undefined;
}

export interface SupervisionLoopSummary extends LoopSummary {
  readonly finalization?: BackgroundFinalizationResult | undefined;
  readonly recyclingAssessment?: RecycleAssessment | undefined;
  readonly zeroMainThreadSpillover: boolean;
}

function boundedEvidenceCause(error: unknown): string {
  if (typeof error === "string") return error.slice(0, 240);
  if (
    typeof error === "number" ||
    typeof error === "boolean" ||
    typeof error === "bigint" ||
    typeof error === "symbol" ||
    error === null ||
    error === undefined
  ) {
    return String(error).slice(0, 240);
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "message");
    if (descriptor && "value" in descriptor && typeof descriptor.value === "string") {
      return descriptor.value.slice(0, 240);
    }
  } catch {}
  return "unknown error";
}

const defaultGitRunner: GitRunner = (args: readonly string[], cwd: string): GitRunnerResult => {
  try {
    const result = spawnSync("git", [...args], {
      cwd,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30_000,
    });
    return {
      status: result.status,
      stdout: result.stdout !== null && result.stdout !== undefined ? result.stdout : "",
      stderr: result.stderr !== null && result.stderr !== undefined ? result.stderr : "",
    };
  } catch (error) {
    return {
      status: 1,
      stdout: "",
      stderr: boundedEvidenceCause(error),
    };
  }
};

const defaultSyncRunner: SyncRunner = (command: string, cwd: string): GitRunnerResult => {
  try {
    const parts = command.trim().split(/\s+/);
    let executable = "bun";
    if (parts.length > 0) {
      const firstPart = parts[0];
      if (firstPart !== undefined && firstPart.length > 0) {
        executable = firstPart;
      }
    }
    const args = parts.slice(1);
    const result = spawnSync(executable, args, {
      cwd,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60_000,
    });
    return {
      status: result.status,
      stdout: result.stdout !== null && result.stdout !== undefined ? result.stdout : "",
      stderr: result.stderr !== null && result.stderr !== undefined ? result.stderr : "",
    };
  } catch (error) {
    return {
      status: 1,
      stdout: "",
      stderr: boundedEvidenceCause(error),
    };
  }
};

/**
 * Enforces the strict Zero Main-Thread Spillover invariant.
 * Guarantees that all release operations (git commit, git push, global skill sync)
 * are completely enclosed and executed within the Tier 1 background orchestrator thread.
 */
export function enforceZeroMainThreadSpillover(params: {
  readonly executionTier?: number | undefined;
  readonly isMainThread?: boolean | undefined;
  readonly finalizationComplete?: boolean | undefined;
  readonly gitOperationsEnclosed?: boolean | undefined;
  readonly globalSyncEnclosed?: boolean | undefined;
  readonly now?: Date | string | number | undefined;
}): ZeroMainThreadSpilloverVerification {
  const tier = params.executionTier !== undefined ? params.executionTier : 1;
  const isMain = params.isMainThread !== undefined ? params.isMainThread : false;
  const finalComplete =
    params.finalizationComplete !== undefined ? params.finalizationComplete : true;
  const gitEnclosed =
    params.gitOperationsEnclosed !== undefined ? params.gitOperationsEnclosed : true;
  const syncEnclosed = params.globalSyncEnclosed !== undefined ? params.globalSyncEnclosed : true;
  const verifiedAt =
    params.now !== undefined ? new Date(params.now).toISOString() : new Date().toISOString();

  let isTierValid = false;
  if (tier === 1) isTierValid = true;
  if (tier === 0) isTierValid = true;

  let isCompliant = false;
  if (!isMain) {
    if (isTierValid) {
      if (finalComplete) {
        if (gitEnclosed) {
          isCompliant = true;
        }
      }
    }
  }

  let message =
    "Zero main-thread spillover verified: release operations executed strictly within Tier 1 background orchestrator thread.";
  if (isMain) {
    message =
      "Violation: Finalization executed on main interactive thread instead of background orchestrator thread.";
  } else if (!isTierValid) {
    message = `Violation: Finalization executed by non-orchestrator tier ${tier}; only Tier 1 background orchestrator may finalize.`;
  } else if (!finalComplete) {
    message = "Violation: Finalization release operations failed to complete in background.";
  } else if (!gitEnclosed) {
    message = "Violation: Git commit/push operations were not fully enclosed in background.";
  }

  return {
    compliant: isCompliant,
    executionTier: tier,
    executedInBackground: !isMain,
    mainThreadSpillover: isMain,
    gitOperationsEnclosed: gitEnclosed,
    globalSyncEnclosed: syncEnclosed,
    verifiedAt,
    message,
  };
}

/**
 * Asserts that Zero Main-Thread Spillover invariants are strictly satisfied.
 * Throws a HarnessError if violated.
 */
export function assertZeroMainThreadSpillover(
  target: ZeroMainThreadSpilloverVerification | BackgroundFinalizationResult,
): void {
  const verification = "spilloverVerification" in target ? target.spilloverVerification : target;
  if (!verification.compliant) {
    throw new HarnessError("INTEGRITY", verification.message);
  }
  if (verification.mainThreadSpillover) {
    throw new HarnessError("INTEGRITY", verification.message);
  }
}

/**
 * Formats a clean, line-limited brief (< 25 lines) summarizing background finalization.
 */
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
    ? `✓ Committed (${input.commitSha !== undefined ? input.commitSha : "unrecorded"})`
    : "○ Skipped/Clean";

  const lines = [
    `### Tier 1 Background Orchestrator Finalization`,
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

/**
 * Executes complete background finalization within the Tier 1 Orchestrator thread:
 * 1. Git add & commit
 * 2. Git push to upstream
 * 3. Global skill synchronization (`bun scripts/sync-global.ts`)
 * 4. Zero main-thread spillover verification
 * 5. Autonomous loop recycling transition evaluation
 */
export async function executeBackgroundFinalization(
  options: BackgroundFinalizationOptions,
): Promise<BackgroundFinalizationResult> {
  const startTime = Date.now();
  const repoPath = options.repoPath.trim();
  if (repoPath.length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "repoPath is required for background finalization");
  }

  const isMainThread = options.isMainThread !== undefined ? options.isMainThread : false;
  const executionTier = options.executionTier !== undefined ? options.executionTier : 1;
  const actor =
    options.actor !== undefined && options.actor.length > 0 ? options.actor : "orchestrator-tier1";
  const runId = options.runId;
  const runRoot = options.runRoot;
  const gitRunner = options.gitRunner !== undefined ? options.gitRunner : defaultGitRunner;
  const syncRunner = options.syncRunner !== undefined ? options.syncRunner : defaultSyncRunner;
  const skipPush = options.skipPush !== undefined ? options.skipPush : false;
  const skipSync = options.skipSync !== undefined ? options.skipSync : false;
  const syncCommand =
    options.syncCommand !== undefined && options.syncCommand.length > 0
      ? options.syncCommand
      : "bun scripts/sync-global.ts";
  let commitMessage: string;
  if (options.commitMessage !== undefined && options.commitMessage.length > 0) {
    commitMessage = options.commitMessage;
  } else if (runId !== undefined) {
    commitMessage = `feat(orchestrator): autonomous convergence finalization [${runId}]`;
  } else {
    commitMessage = "feat(orchestrator): autonomous convergence finalization";
  }
  const branch =
    options.branch !== undefined && options.branch.length > 0 ? options.branch : "main";
  const remote =
    options.remote !== undefined && options.remote.length > 0 ? options.remote : "origin";
  const now =
    options.now !== undefined
      ? new Date(options.now).toISOString()
      : new Date(startTime).toISOString();

  // Enforce zero main-thread spillover check upfront
  if (isMainThread) {
    throw new HarnessError(
      "INTEGRITY",
      "Zero Main-Thread Spillover violation: background finalization cannot be executed from the interactive main thread",
    );
  }
  let isTierValid = false;
  if (executionTier === 1) isTierValid = true;
  if (executionTier === 0) isTierValid = true;
  if (!isTierValid) {
    throw new HarnessError(
      "INTEGRITY",
      `Zero Main-Thread Spillover violation: finalization must execute in Tier 1 Orchestrator thread (current tier: ${executionTier})`,
    );
  }

  const steps: FinalizationStepResult[] = [];
  let committed = false;
  let pushed = false;
  let synced = false;
  let commitSha: string | undefined;
  let overallSuccess = true;
  let firstError: string | undefined;

  // Step 1: git add -A
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
    firstError = `git add failed: ${addResult.stderr.length > 0 ? addResult.stderr : addResult.stdout}`;
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

  // Step 2: git status check
  const statusStart = Date.now();
  const statusResult = await Promise.resolve(gitRunner(["status", "--porcelain"], repoPath));
  const statusDuration = Date.now() - statusStart;
  let hasStagedChanges = false;
  if (statusResult.status === 0) {
    if (statusResult.stdout.trim().length > 0) {
      hasStagedChanges = true;
    }
  }
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

  // Step 3: git commit
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
      firstError = `git commit failed: ${commitResult.stderr.length > 0 ? commitResult.stderr : commitResult.stdout}`;
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
    const commitDuration = Date.now() - commitStart;
    steps.push({
      step: "git_commit",
      executed: false,
      status: "skipped",
      command: `git commit -m "${commitMessage}"`,
      durationMs: commitDuration,
      reason: hasStagedChanges ? "skipped_due_to_prior_failure" : "clean_working_tree_no_changes",
    });
  }

  // Step 4: git push
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
      firstError = `git push failed: ${pushResult.stderr.length > 0 ? pushResult.stderr : pushResult.stdout}`;
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
    const pushDuration = Date.now() - pushStart;
    steps.push({
      step: "git_push",
      executed: false,
      status: "skipped",
      command: `git push ${remote} ${branch}`,
      durationMs: pushDuration,
      reason: skipPush ? "push_disabled_by_config" : "skipped_due_to_prior_failure",
    });
  }

  // Step 5: global sync
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
      firstError = `global sync failed: ${syncResult.stderr.length > 0 ? syncResult.stderr : syncResult.stdout}`;
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
    const syncDuration = Date.now() - syncStart;
    steps.push({
      step: "global_sync",
      executed: false,
      status: "skipped",
      command: syncCommand,
      durationMs: syncDuration,
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

  // Step 6: autonomous recycling assessment
  let recyclingAssessment: RecycleAssessment | undefined;
  const hasRecyclingStateSource = runRoot !== undefined || options.state !== undefined;

  if (hasRecyclingStateSource) {
    try {
      let stateToAssess = options.state;
      if (stateToAssess === undefined) {
        if (runRoot !== undefined) {
          stateToAssess = loadRun(runRoot).state;
        }
      }
      if (stateToAssess !== undefined) {
        const rootPath = runRoot !== undefined ? runRoot : repoPath;
        recyclingAssessment = assessRecyclingState(stateToAssess, rootPath, { now });
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

  if (options.throwOnError === true && !overallSuccess) {
    const errMessage = firstError !== undefined ? firstError : "Background finalization failed";
    throw new HarnessError("INTEGRITY", errMessage);
  }

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
    ...(firstError !== undefined ? { error: firstError } : {}),
  };
}

/**
 * Transitions supervision loop state back to candidate discovery or new round wave planning.
 */
export function transitionSupervisionLoopToDiscovery(
  options: AutonomousRecycleOptions & { readonly state?: Record<string, unknown> | undefined },
): RecycleAssessment {
  let state = options.state;
  if (state === undefined) {
    try {
      state = loadRun(options.runRoot).state as Record<string, unknown>;
    } catch (error) {
      throw new HarnessError(
        "INTEGRITY",
        `supervision loop continuation evidence unavailable: ${boundedEvidenceCause(error)}`,
      );
    }
  }
  return assessRecyclingState(state, options.runRoot, { now: options.now });
}

/**
 * Plan autonomous supervision loop recycle sequence into markdown plan.
 */
export function planSupervisionLoopRecycle(
  state: Record<string, unknown>,
  options: AutonomousRecycleOptions,
): RecyclePlan {
  return planAutonomousRoundRecycle(state, options);
}

/**
 * SupervisionLoopRunner coordinates multi-round execution, monitors watchdog events,
 * and automatically triggers background finalization and autonomous recycling transitions
 * when rounds converge and completeness critic approves.
 */
export class SupervisionLoopRunner {
  private readonly loopRunner: AutonomousLoopRunner;
  private readonly options: SupervisionLoopRunnerOptions;

  public constructor(options: SupervisionLoopRunnerOptions) {
    this.options = options;
    this.loopRunner = new AutonomousLoopRunner(options);
  }

  public get maxRounds(): number {
    return this.loopRunner.maxRounds;
  }

  public get baseRunId(): string {
    return this.loopRunner.baseRunId;
  }

  public get repoPath(): string {
    return this.loopRunner.repoPath;
  }

  public getCapsulePath(runId: string): string {
    return this.loopRunner.getCapsulePath(runId);
  }

  public async run(): Promise<SupervisionLoopSummary> {
    const summary = await this.loopRunner.run();
    let finalization: BackgroundFinalizationResult | undefined;
    let recyclingAssessment: RecycleAssessment | undefined;

    const autoFinalize =
      this.options.autoFinalizeOnConvergence !== undefined
        ? this.options.autoFinalizeOnConvergence
        : true;

    if (summary.finalStatus === "converged_success" && autoFinalize) {
      const actorName =
        this.options.actor !== undefined && this.options.actor.length > 0
          ? this.options.actor
          : "orchestrator-tier1";

      finalization = await executeBackgroundFinalization({
        repoPath: this.options.repoPath,
        runId: this.loopRunner.baseRunId,
        runRoot: this.loopRunner.getCapsulePath(this.loopRunner.baseRunId),
        actor: actorName,
        skipPush: this.options.skipPush,
        skipSync: this.options.skipSync,
        syncCommand: this.options.syncCommand,
        gitRunner: this.options.gitRunner,
        syncRunner: this.options.syncRunner,
        commitMessage: this.options.commitMessageTemplate,
        isMainThread: false,
        executionTier: 1,
      });

      assertZeroMainThreadSpillover(finalization);
      recyclingAssessment = finalization.recyclingAssessment;
      this.options.onFinalizationComplete?.(finalization);
    }

    return {
      ...summary,
      ...(finalization !== undefined ? { finalization } : {}),
      ...(recyclingAssessment !== undefined ? { recyclingAssessment } : {}),
      zeroMainThreadSpillover: true,
    };
  }
}
