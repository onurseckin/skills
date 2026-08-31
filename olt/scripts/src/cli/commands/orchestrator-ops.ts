import { existsSync } from "node:fs";
import { getHarnessConfig } from "../../core/config/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { readBoundedBytes } from "../../core/json.ts";
import { findRepoRoot } from "../../core/shared/paths.ts";
import { AutonomousLoopRunner } from "../../orchestrator/loop-runner.ts";
import { formatMorningReportMarkdown } from "../../orchestrator/morning-report.ts";
import { runSupervisionWatch } from "../../orchestrator/supervision-watch.ts";
import { RunSupervisor, type TaskDispatcher } from "../../orchestrator/supervisor.ts";
import type { RoundExecutor } from "../../orchestrator/types.ts";
import { refreshHandoff } from "../../reporting/handoff.ts";
import { boolFlag, integerFlag, textFlag, type CommandContext, type Flags } from "../options.ts";
import { DEFAULT_WATCH_INTERVAL_SECONDS } from "../registry/orchestrator.ts";

export { DEFAULT_WATCH_INTERVAL_SECONDS };

export interface OrchestratorCommandContext extends CommandContext {
  executor?: RoundExecutor | undefined;
  dispatcher?: TaskDispatcher | undefined;
  signal?: AbortSignal | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

export async function orchestratorRunCommand(
  flags: Flags,
  context: OrchestratorCommandContext = {},
): Promise<Record<string, unknown>> {
  const repo = textFlag(flags, "repo", false) ?? process.cwd();
  if (!existsSync(repo)) {
    throw new HarnessError("INVALID_ARGUMENT", `repository path does not exist: ${repo}`);
  }

  const actor = textFlag(flags, "actor", false);
  const runId =
    textFlag(flags, "run-id", false) ??
    textFlag(flags, "run", false) ??
    `orchestrator-${Date.now()}`;
  const capsulesDir = textFlag(flags, "capsules-dir", false);

  const rawMaxRounds = integerFlag(flags, "max-rounds");
  const maxRounds = rawMaxRounds !== undefined ? Math.min(10, Math.max(1, rawMaxRounds)) : 10;

  const inlinePrompt = textFlag(flags, "prompt", false);
  const promptFile = textFlag(flags, "prompt-file", false);
  const _fromStdinFlag = boolFlag(flags, "prompt-stdin");

  let prompt: string | undefined;
  if (inlinePrompt !== undefined) {
    prompt = inlinePrompt;
  } else if (promptFile !== undefined) {
    try {
      const bytes = readBoundedBytes(promptFile, 64 * 1024 * 1024);
      prompt = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `failed to read prompt file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else if (context.stdin !== undefined) {
    try {
      prompt = new TextDecoder("utf-8", { fatal: true }).decode(context.stdin);
    } catch (error) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `failed to decode stdin prompt: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (!prompt || prompt.trim().length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "must provide prompt via --prompt, --prompt-file, or stdin",
    );
  }

  if (context.executor === undefined) {
    throw new HarnessError(
      "INVALID_STATE",
      "orchestrator:run requires a host-injected round executor; the CLI cannot execute a round by itself",
    );
  }

  const loopRunner = new AutonomousLoopRunner({
    baseRunId: runId,
    repoPath: repo,
    initialPrompt: prompt,
    maxRounds,
    ...(capsulesDir !== undefined ? { capsulesDir } : {}),
    ...(actor !== undefined ? { actor } : {}),
    ...(context.executor !== undefined ? { executor: context.executor } : {}),
  });

  const summary = await loopRunner.run();

  return {
    markdown: summary.finalMarkdownSummary,
    loop_id: summary.loopId,
    base_run_id: summary.baseRunId,
    finalStatus: summary.finalStatus,
    final_status: summary.finalStatus,
    rounds_executed: summary.totalRoundsExecuted,
    total_rounds_executed: summary.totalRoundsExecuted,
    max_rounds_configured: summary.maxRoundsConfigured,
    overall_duration_ms: summary.overallDurationMs,
    gate_status: summary.gateStatus,
    final_critic_decision: summary.finalCriticDecision,
    total_findings_synthesized: summary.totalFindingsSynthesized,
    telemetry: summary.rounds,
    rounds: summary.rounds,
    summary,
    run_root: loopRunner.getCapsulePath(summary.baseRunId),
    capsules_dir: loopRunner.capsulesDir,
  };
}

function repoConfigFor(runRoot: string): ReturnType<typeof getHarnessConfig> {
  return getHarnessConfig(findRepoRoot(runRoot), runRoot);
}

interface SuperviseWatchInput {
  readonly run: string;
  readonly actor: string;
  readonly intervalSeconds: number;
  readonly recoveryEnabled: boolean;
  readonly maxParallel: number;
  readonly maxParallelSource: string;
  readonly maxConcurrentAgents?: number;
  readonly gateMaxParallel: number;
  readonly graceSeconds?: number;
  readonly maxElapsedMsPerTask?: number;
  readonly deterministicRepeatThreshold?: number;
}

async function runOrchestratorSuperviseWatch(
  context: OrchestratorCommandContext,
  input: SuperviseWatchInput,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const forwardHostStop = (): void => controller.abort();
  context.signal?.addEventListener("abort", forwardHostStop, { once: true });
  if (context.signal?.aborted === true) controller.abort();
  const stopOnProcessSignal = (): void => controller.abort();
  process.once("SIGINT", stopOnProcessSignal);
  process.once("SIGTERM", stopOnProcessSignal);

  try {
    const result = await runSupervisionWatch({
      runRoot: input.run,
      actor: input.actor,
      intervalMs: input.intervalSeconds * 1_000,
      recoveryEnabled: input.recoveryEnabled,
      maxParallel: input.maxParallel,
      gateMaxParallel: input.gateMaxParallel,
      signal: controller.signal,
      ...(input.graceSeconds === undefined ? {} : { graceSeconds: input.graceSeconds }),
      ...(input.maxElapsedMsPerTask === undefined
        ? {}
        : { maxElapsedMsPerTask: input.maxElapsedMsPerTask }),
      ...(input.deterministicRepeatThreshold === undefined
        ? {}
        : { deterministicRepeatThreshold: input.deterministicRepeatThreshold }),
      ...(context.sleep === undefined ? {} : { sleep: context.sleep }),
    });

    const handoffPath = refreshHandoff(input.run);

    return {
      markdown: formatMorningReportMarkdown(result.report, input.run),
      run_root: input.run,
      stop_reason: result.stopReason,
      ticks: result.ticks,
      reclaimed: result.lastTick.reclaimed,
      escalated_now: result.lastTick.escalatedNow,
      changes_requested: result.lastTick.changesRequested,
      occupied: result.lastTick.occupied,
      max_parallel: input.maxParallel,
      max_parallel_source: input.maxParallelSource,
      max_concurrent_agents: input.maxConcurrentAgents,
      gate_max_parallel: input.gateMaxParallel,
      recovery_enabled: input.recoveryEnabled,
      watch: true,
      interval_seconds: input.intervalSeconds,
      report: result.report,
      ...(handoffPath === undefined ? {} : { handoff_path: handoffPath }),
    };
  } finally {
    process.off("SIGINT", stopOnProcessSignal);
    process.off("SIGTERM", stopOnProcessSignal);
    context.signal?.removeEventListener("abort", forwardHostStop);
  }
}

export async function orchestratorSuperviseCommand(
  flags: Flags,
  context: OrchestratorCommandContext = {},
): Promise<Record<string, unknown>> {
  const run = textFlag(flags, "run")!;
  const actor = textFlag(flags, "actor")!;
  const maxParallelFlag = integerFlag(flags, "max-parallel", { minimum: 1, maximum: 64 });
  const resolvedConfig = repoConfigFor(run);
  const maxParallel = maxParallelFlag ?? resolvedConfig.default_max_parallel;
  const maxParallelSource =
    maxParallelFlag !== undefined ? "cli_flag" : resolvedConfig.default_max_parallel_source;
  const gateMaxParallel =
    integerFlag(flags, "gate-max-parallel", { minimum: 1, maximum: 64 }) ??
    resolvedConfig.gate_max_parallel;
  const recoveryEnabled = !boolFlag(flags, "no-recover");
  const graceSeconds = integerFlag(flags, "grace-seconds", { minimum: 0, maximum: 86_400 });
  const pollIntervalMs = integerFlag(flags, "poll-interval-ms", { minimum: 100 });
  const maxElapsedMsPerTask = integerFlag(flags, "max-elapsed-ms", { minimum: 1_000 });
  const maxTotalElapsedMs = integerFlag(flags, "max-total-elapsed-ms", { minimum: 1_000 });
  const deterministicRepeatThreshold = integerFlag(flags, "deterministic-repeat-threshold", {
    minimum: 1,
  });
  const watch = boolFlag(flags, "watch");
  const intervalSecondsFlag = integerFlag(flags, "interval", { minimum: 1 });
  if (intervalSecondsFlag !== undefined && !watch) {
    throw new HarnessError("INVALID_ARGUMENT", "--interval only applies with --watch");
  }

  if (watch) {
    return runOrchestratorSuperviseWatch(context, {
      run,
      actor,
      intervalSeconds: intervalSecondsFlag ?? DEFAULT_WATCH_INTERVAL_SECONDS,
      recoveryEnabled,
      maxParallel,
      maxParallelSource,
      gateMaxParallel,
      ...(resolvedConfig.max_concurrent_agents === undefined
        ? {}
        : { maxConcurrentAgents: resolvedConfig.max_concurrent_agents }),
      ...(graceSeconds === undefined ? {} : { graceSeconds }),
      ...(maxElapsedMsPerTask === undefined ? {} : { maxElapsedMsPerTask }),
      ...(deterministicRepeatThreshold === undefined ? {} : { deterministicRepeatThreshold }),
    });
  }

  const supervisor = new RunSupervisor({
    runRoot: run,
    actor,
    maxParallel,
    gateMaxParallel,
    recoveryEnabled,
    ...(graceSeconds === undefined ? {} : { graceSeconds }),
    ...(pollIntervalMs === undefined ? {} : { pollIntervalMs }),
    ...(maxElapsedMsPerTask === undefined ? {} : { maxElapsedMsPerTask }),
    ...(maxTotalElapsedMs === undefined ? {} : { maxTotalElapsedMs }),
    ...(deterministicRepeatThreshold === undefined ? {} : { deterministicRepeatThreshold }),
    ...(context.dispatcher === undefined ? {} : { dispatcher: context.dispatcher }),
  });

  const result = await supervisor.run();
  const handoffPath = refreshHandoff(run);

  return {
    markdown: formatMorningReportMarkdown(result.report, run),
    run_root: run,
    stop_reason: result.stopReason,
    ticks: result.ticks,
    reclaimed: result.lastTick.reclaimed,
    escalated_now: result.lastTick.escalatedNow,
    changes_requested: result.lastTick.changesRequested,
    dispatchable: result.lastTick.dispatchable,
    backing_off: result.lastTick.backingOff,
    occupied: result.lastTick.occupied,
    max_parallel: result.lastTick.maxParallel,
    max_parallel_source: maxParallelSource,
    max_concurrent_agents: resolvedConfig.max_concurrent_agents,
    gate_max_parallel: result.lastTick.gateMaxParallel,
    recovery_enabled: recoveryEnabled,
    watch: false,
    report: result.report,
    ...(handoffPath === undefined ? {} : { handoff_path: handoffPath }),
  };
}

export { orchestratorSuperviseCommand as orchestratorTickCommand };
