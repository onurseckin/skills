import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../errors/harness-error.ts";
import { OrchestratorWatchdog } from "./watchdog.ts";
import { synthesizeNextRoundPrompt } from "./defect-synthesizer.ts";
import { chainCapsules } from "./capsule-chainer.ts";
import { loopGateStatus, roundGateStatus } from "./gate-status.ts";
import { formatLoopMarkdownSummary } from "./loop-summary-brief.ts";
import type {
  CapsuleChainManifest,
  DefectSynthesis,
  LoopExecutionStatus,
  LoopRunnerOptions,
  LoopSummary,
  RoundExecutionInput,
  RoundExecutionResult,
  RoundExecutor,
  RoundTelemetry,
  WatchdogEvent,
} from "./types.ts";

export class AutonomousLoopRunner {
  public static readonly MAX_ALLOWED_ROUNDS = 10;
  public static readonly DEFAULT_MAX_ROUNDS = 10;

  public readonly baseRunId: string;
  public readonly repoPath: string;
  public readonly initialPrompt: string;
  public readonly maxRoundsConfigured: number;
  public readonly capsulesDir: string;
  public readonly actor: string | undefined;

  private readonly executor?: RoundExecutor | undefined;
  private readonly watchdog: OrchestratorWatchdog;

  private readonly onRoundStart?: ((round: number, runId: string) => void) | undefined;
  private readonly onRoundComplete?: ((telemetry: RoundTelemetry) => void) | undefined;
  private readonly onDefectSynthesis?: ((synthesis: DefectSynthesis) => void) | undefined;
  private readonly onCapsuleChained?: ((manifest: CapsuleChainManifest) => void) | undefined;
  private readonly onStall?: ((event: WatchdogEvent) => void) | undefined;
  private readonly onLoopComplete?: ((summary: LoopSummary) => void) | undefined;

  public constructor(options: LoopRunnerOptions) {
    if (!options.baseRunId || options.baseRunId.trim().length === 0) {
      throw new HarnessError("INVALID_ARGUMENT", "baseRunId is required");
    }
    if (!options.repoPath || options.repoPath.trim().length === 0) {
      throw new HarnessError("INVALID_ARGUMENT", "repoPath is required");
    }
    if (!options.initialPrompt || options.initialPrompt.trim().length === 0) {
      throw new HarnessError("INVALID_ARGUMENT", "initialPrompt is required");
    }

    const requestedMax = options.maxRounds ?? AutonomousLoopRunner.DEFAULT_MAX_ROUNDS;
    this.maxRoundsConfigured = Math.min(
      AutonomousLoopRunner.MAX_ALLOWED_ROUNDS,
      Math.max(1, requestedMax),
    );
    this.baseRunId = options.baseRunId.trim();
    this.repoPath = options.repoPath.trim();
    this.initialPrompt = options.initialPrompt;
    this.capsulesDir = options.capsulesDir ?? join(this.repoPath, ".capsules");
    this.actor = options.actor;
    this.executor = options.executor;
    this.onRoundStart = options.onRoundStart;
    this.onRoundComplete = options.onRoundComplete;
    this.onDefectSynthesis = options.onDefectSynthesis;
    this.onCapsuleChained = options.onCapsuleChained;
    this.onStall = options.onStall;
    this.onLoopComplete = options.onLoopComplete;

    this.watchdog = new OrchestratorWatchdog(options.watchdogConfig ?? {});
    if (this.onStall) {
      this.watchdog.on("stall_detected", this.onStall);
      this.watchdog.on("auto_wake", this.onStall);
    }
  }

  public get maxRounds(): number {
    return this.maxRoundsConfigured;
  }

  public getWatchdog(): OrchestratorWatchdog {
    return this.watchdog;
  }

  public getCapsulePath(runId: string): string {
    return join(this.capsulesDir, runId);
  }

  public getRoundRunId(roundNumber: number): string {
    return `${this.baseRunId}-round-${roundNumber}`;
  }

  public async run(): Promise<LoopSummary> {
    // Without an injected executor nothing can execute a round. Reporting a synthetic approved
    // round here would write a signed summary claiming work that never happened, so the loop
    // refuses to start instead.
    const executor = this.executor;
    if (!executor)
      throw new HarnessError(
        "INVALID_STATE",
        "autonomous loop has no round executor; the host must inject one before orchestrator:run can execute a round",
      );
    const loopStartTime = Date.now();
    const startedAt = new Date(loopStartTime).toISOString();
    const roundTelemetryList: RoundTelemetry[] = [];
    let currentPrompt = this.initialPrompt;
    let priorSynthesis: DefectSynthesis | undefined;
    let finalStatus: LoopExecutionStatus = "running";
    let totalSynthesizedFindings = 0;
    let lastCriticDecision: RoundTelemetry["criticDecision"] = undefined;

    if (!existsSync(this.capsulesDir)) mkdirSync(this.capsulesDir, { recursive: true });
    this.watchdog.start();

    try {
      for (let round = 1; round <= this.maxRoundsConfigured; round++) {
        const roundRunId = this.getRoundRunId(round);
        const roundCapsulePath = this.getCapsulePath(roundRunId);
        const roundStartTime = Date.now();
        this.onRoundStart?.(round, roundRunId);

        const monitorId = `round-${round}-${roundRunId}`;
        this.watchdog.registerMonitor(monitorId, {
          agentId: `coordinator-r${round}`,
          runId: roundRunId,
          initialStartedAt: roundStartTime,
        });

        if (round > 1) {
          const prevRunId = this.getRoundRunId(round - 1);
          const prevCapsulePath = this.getCapsulePath(prevRunId);
          const chainManifest = chainCapsules({
            sourceRunId: prevRunId,
            targetRunId: roundRunId,
            sourceCapsulePath: prevCapsulePath,
            targetCapsulePath: roundCapsulePath,
            roundNumber: round,
            defectSynthesis: priorSynthesis,
          });
          this.onCapsuleChained?.(chainManifest);
        } else if (!existsSync(roundCapsulePath)) {
          mkdirSync(roundCapsulePath, { recursive: true });
        }

        const executionInput: RoundExecutionInput = {
          round,
          runId: roundRunId,
          capsulePath: roundCapsulePath,
          prompt: currentPrompt,
          repoPath: this.repoPath,
          isFirstRound: round === 1,
          previousRoundRunId: round > 1 ? this.getRoundRunId(round - 1) : undefined,
          priorDefects: priorSynthesis,
        };

        const result: RoundExecutionResult = await executor.executeRound(executionInput);

        const roundEndTime = Date.now();
        const durationMs = roundEndTime - roundStartTime;
        this.watchdog.unregisterMonitor(monitorId);

        const openFindings = result.findings.filter((f) => f.status !== "resolved");
        const resolvedFindings = result.findings.filter((f) => f.status === "resolved");
        const gateStatus = roundGateStatus(result.gateResults);
        const isApprovedByCritic = result.criticDecision === "approve";
        lastCriticDecision = result.criticDecision;

        const telemetry: RoundTelemetry = {
          round,
          runId: roundRunId,
          status: result.status,
          startedAt: new Date(roundStartTime).toISOString(),
          completedAt: new Date(roundEndTime).toISOString(),
          durationMs,
          criticDecision: result.criticDecision,
          taskCount: result.tasks.length,
          completedTaskCount: result.tasks.filter(
            (t) => t.status === "done" || t.status === "validated",
          ).length,
          openFindingsCount: openFindings.length,
          resolvedFindingsCount: resolvedFindings.length,
          gateStatus,
          gateCount: result.gateResults.length,
          summary: result.summary,
        };

        roundTelemetryList.push(telemetry);
        this.onRoundComplete?.(telemetry);

        // Convergence demands gates that actually ran and passed. A round with no gate result has
        // proven nothing, so it can never seal the loop as a success.
        if (
          result.status === "completed" &&
          isApprovedByCritic &&
          gateStatus === "passed" &&
          openFindings.length === 0
        ) {
          finalStatus = "converged_success";
          break;
        }
        if (result.status === "failed" || result.status === "escalated") {
          finalStatus = result.status === "failed" ? "failed" : "stalled";
          break;
        }
        if (round === this.maxRoundsConfigured) {
          finalStatus = "max_rounds_reached";
          break;
        }

        const failedGates = result.gateResults
          .filter((g) => g.status !== "passed")
          .map((g) => g.gate_id);

        priorSynthesis = synthesizeNextRoundPrompt({
          roundNumber: round + 1,
          priorRunId: roundRunId,
          originalPrompt: this.initialPrompt,
          findings: openFindings.length > 0 ? openFindings : result.findings,
          criticDecision: result.criticDecision,
          criticFeedback: result.summary,
          gateResults: result.gateResults,
          gateFailures: failedGates,
        });

        totalSynthesizedFindings += priorSynthesis.unresolvedFindings.length;
        currentPrompt = priorSynthesis.synthesizedPrompt;
        this.onDefectSynthesis?.(priorSynthesis);
      }
    } finally {
      this.watchdog.dispose();
    }

    const loopEndTime = Date.now();
    const completedAt = new Date(loopEndTime).toISOString();
    const overallDurationMs = loopEndTime - loopStartTime;
    const gateStatus = loopGateStatus(roundTelemetryList);

    const markdownSummary = formatLoopMarkdownSummary({
      loopId: `loop-${this.baseRunId}`,
      baseRunId: this.baseRunId,
      totalRoundsExecuted: roundTelemetryList.length,
      maxRoundsConfigured: this.maxRoundsConfigured,
      finalStatus,
      overallDurationMs,
      rounds: roundTelemetryList,
      totalFindingsSynthesized: totalSynthesizedFindings,
      gateStatus,
      finalCriticDecision: lastCriticDecision,
    });

    const loopSummary: LoopSummary = {
      loopId: `loop-${this.baseRunId}`,
      baseRunId: this.baseRunId,
      totalRoundsExecuted: roundTelemetryList.length,
      maxRoundsConfigured: this.maxRoundsConfigured,
      finalStatus,
      startedAt,
      completedAt,
      overallDurationMs,
      rounds: roundTelemetryList,
      totalFindingsSynthesized: totalSynthesizedFindings,
      gateStatus,
      finalCriticDecision: lastCriticDecision,
      finalMarkdownSummary: markdownSummary,
      // Attribution is recorded only when the caller supplied one: an unattributed loop leaves the
      // field off rather than crediting the run to a name nobody gave.
      ...(this.actor === undefined ? {} : { actor: this.actor }),
    };

    const summaryPath = join(this.capsulesDir, `${this.baseRunId}-loop-summary.json`);
    writeFileSync(summaryPath, JSON.stringify(loopSummary, null, 2) + "\n", "utf-8");
    this.onLoopComplete?.(loopSummary);
    return loopSummary;
  }
}

export async function runAutonomousLoop(options: LoopRunnerOptions): Promise<LoopSummary> {
  const runner = new AutonomousLoopRunner(options);
  return runner.run();
}
