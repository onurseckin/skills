import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../errors/harness-error.ts";
import { OrchestratorWatchdog } from "./watchdog.ts";
import { synthesizeNextRoundPrompt } from "./defect-synthesizer.ts";
import { chainCapsules } from "./capsule-chainer.ts";
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
  public readonly actor: string;

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
    this.actor = options.actor ?? "orchestrator";
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

        const result: RoundExecutionResult = this.executor
          ? await this.executor.executeRound(executionInput)
          : await this.defaultExecuteRound(executionInput);

        const roundEndTime = Date.now();
        const durationMs = roundEndTime - roundStartTime;
        this.watchdog.unregisterMonitor(monitorId);

        const openFindings = result.findings.filter((f) => f.status !== "resolved");
        const resolvedFindings = result.findings.filter((f) => f.status === "resolved");
        const gatesPassed =
          result.gateResults.length === 0 || result.gateResults.every((g) => g.status === "passed");
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
          gatesPassed,
          summary: result.summary,
        };

        roundTelemetryList.push(telemetry);
        this.onRoundComplete?.(telemetry);

        if (
          result.status === "completed" &&
          isApprovedByCritic &&
          gatesPassed &&
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
    const allGatesPassed = roundTelemetryList.every((r) => r.gatesPassed);

    const markdownSummary = this.formatLoopMarkdownSummary({
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
      allGatesPassed,
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
      allGatesPassed,
      finalCriticDecision: lastCriticDecision,
      finalMarkdownSummary: markdownSummary,
    };

    const summaryPath = join(this.capsulesDir, `${this.baseRunId}-loop-summary.json`);
    writeFileSync(summaryPath, JSON.stringify(loopSummary, null, 2) + "\n", "utf-8");
    this.onLoopComplete?.(loopSummary);
    return loopSummary;
  }

  private async defaultExecuteRound(input: RoundExecutionInput): Promise<RoundExecutionResult> {
    return {
      runId: input.runId,
      round: input.round,
      status: "completed",
      criticDecision: "approve",
      tasks: [],
      findings: [],
      gateResults: [],
      summary: `Round ${input.round} completed default execution.`,
    };
  }

  private formatLoopMarkdownSummary(summary: {
    readonly loopId: string;
    readonly baseRunId: string;
    readonly totalRoundsExecuted: number;
    readonly maxRoundsConfigured: number;
    readonly finalStatus: LoopExecutionStatus;
    readonly startedAt: string;
    readonly completedAt: string;
    readonly overallDurationMs: number;
    readonly rounds: readonly RoundTelemetry[];
    readonly totalFindingsSynthesized: number;
    readonly allGatesPassed: boolean;
    readonly finalCriticDecision?: RoundTelemetry["criticDecision"] | undefined;
  }): string {
    const lines: string[] = [
      `# Autonomous Multi-Round Loop Summary: \`${summary.baseRunId}\``,
      "",
      `- **Loop ID:** \`${summary.loopId}\``,
      `- **Final Status:** \`${summary.finalStatus}\``,
      `- **Total Rounds Executed:** ${summary.totalRoundsExecuted} / ${summary.maxRoundsConfigured}`,
      `- **Overall Duration:** ${(summary.overallDurationMs / 1000).toFixed(2)}s`,
      `- **Total Synthesized Findings:** ${summary.totalFindingsSynthesized}`,
      `- **All Gates Passed:** ${summary.allGatesPassed ? "✅ Yes" : "❌ No"}`,
      `- **Final Critic Decision:** \`${summary.finalCriticDecision ?? "none"}\``,
      "",
      "## Round Execution Breakdown",
      "",
      "| Round | Run ID | Status | Critic Decision | Tasks Done | Open Findings | Duration |",
      "| :--- | :--- | :--- | :--- | :--- | :--- | :--- |",
    ];

    for (const r of summary.rounds) {
      lines.push(
        `| Round ${r.round} | \`${r.runId}\` | \`${r.status}\` | \`${r.criticDecision ?? "n/a"}\` | ${r.completedTaskCount}/${r.taskCount} | ${r.openFindingsCount} | ${(r.durationMs / 1000).toFixed(2)}s |`,
      );
    }
    lines.push("");
    return lines.join("\n");
  }
}

export async function runAutonomousLoop(options: LoopRunnerOptions): Promise<LoopSummary> {
  const runner = new AutonomousLoopRunner(options);
  return runner.run();
}
