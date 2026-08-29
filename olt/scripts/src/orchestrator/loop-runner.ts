import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../core/errors/index.ts";
import { resolveCapsulesDir } from "../core/shared/paths.ts";
import { normalizeRunId } from "../engine/store/index.ts";
import { OrchestratorCompanionAuditor } from "./companion-auditor.ts";
import { OrchestratorWatchdog } from "./watchdog.ts";
import { synthesizeNextRoundPrompt } from "./defect-synthesizer.ts";
import { chainCapsules } from "./capsule-chainer.ts";
import { loopGateStatus, roundGateStatus } from "./gate-status.ts";
import { formatLoopMarkdownSummary } from "./loop-summary-brief.ts";
import type {
  BehavioralForensicsReport,
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
  public readonly strictAuditorPolicy: boolean;

  private readonly executor?: RoundExecutor | undefined;
  private readonly watchdog: OrchestratorWatchdog;

  private readonly onRoundStart?: ((round: number, runId: string) => void) | undefined;
  private readonly onRoundComplete?: ((telemetry: RoundTelemetry) => void) | undefined;
  private readonly onDefectSynthesis?: ((synthesis: DefectSynthesis) => void) | undefined;
  private readonly onCapsuleChained?: ((manifest: CapsuleChainManifest) => void) | undefined;
  private readonly onStall?: ((event: WatchdogEvent) => void) | undefined;
  private readonly onLoopComplete?: ((summary: LoopSummary) => void) | undefined;
  private readonly onBehavioralForensics?:
    | ((report: BehavioralForensicsReport) => void)
    | undefined;

  public constructor(options: LoopRunnerOptions) {
    if (options.baseRunId === undefined) {
      throw new HarnessError("INVALID_ARGUMENT", "baseRunId is required");
    }
    if (options.baseRunId.trim().length === 0) {
      throw new HarnessError("INVALID_ARGUMENT", "baseRunId is required");
    }
    if (options.repoPath === undefined) {
      throw new HarnessError("INVALID_ARGUMENT", "repoPath is required");
    }
    if (options.repoPath.trim().length === 0) {
      throw new HarnessError("INVALID_ARGUMENT", "repoPath is required");
    }
    if (options.initialPrompt === undefined) {
      throw new HarnessError("INVALID_ARGUMENT", "initialPrompt is required");
    }
    if (options.initialPrompt.trim().length === 0) {
      throw new HarnessError("INVALID_ARGUMENT", "initialPrompt is required");
    }

    const requestedMax =
      options.maxRounds !== undefined ? options.maxRounds : AutonomousLoopRunner.DEFAULT_MAX_ROUNDS;
    this.maxRoundsConfigured = Math.min(
      AutonomousLoopRunner.MAX_ALLOWED_ROUNDS,
      Math.max(1, requestedMax),
    );
    this.baseRunId = normalizeRunId(options.baseRunId);
    this.repoPath = options.repoPath.trim();
    this.initialPrompt = options.initialPrompt;
    this.capsulesDir =
      options.capsulesDir !== undefined ? options.capsulesDir : resolveCapsulesDir(this.repoPath);
    this.actor = options.actor;
    this.strictAuditorPolicy = options.strictAuditorPolicy === true;
    this.executor = options.executor;
    this.onRoundStart = options.onRoundStart;
    this.onRoundComplete = options.onRoundComplete;
    this.onDefectSynthesis = options.onDefectSynthesis;
    this.onCapsuleChained = options.onCapsuleChained;
    this.onStall = options.onStall;
    this.onLoopComplete = options.onLoopComplete;
    this.onBehavioralForensics = options.onBehavioralForensics;

    this.watchdog = new OrchestratorWatchdog(
      options.watchdogConfig !== undefined ? options.watchdogConfig : {},
    );
    if (this.onStall !== undefined) {
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
    const executor = this.executor;
    if (executor === undefined) {
      throw new HarnessError(
        "INVALID_STATE",
        "autonomous loop has no round executor; the host must inject one before orchestrator:run can execute a round",
      );
    }

    // 1. Auto-pair companion Skill Auditor out-of-band alongside Orchestrator
    const companionPairing = OrchestratorCompanionAuditor.pairCompanion(this.repoPath, {
      strictPolicy: this.strictAuditorPolicy,
    });

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

        // Run behavioral forensics for the completed round
        const behavioralForensics = OrchestratorCompanionAuditor.executeForensics(this.repoPath, {
          capsuleRunRoot: roundCapsulePath,
          now: new Date(roundEndTime).toISOString(),
        });
        this.onBehavioralForensics?.(behavioralForensics);

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
          completedTaskCount: result.tasks.filter((t) => {
            if (t.status === "done") return true;
            if (t.status === "validated") return true;
            return false;
          }).length,
          openFindingsCount: openFindings.length,
          resolvedFindingsCount: resolvedFindings.length,
          gateStatus,
          gateCount: result.gateResults.length,
          summary: result.summary,
          behavioralForensics,
        };

        roundTelemetryList.push(telemetry);
        this.onRoundComplete?.(telemetry);

        if (
          result.status === "completed" &&
          isApprovedByCritic &&
          gateStatus === "passed" &&
          openFindings.length === 0
        ) {
          finalStatus = "converged_success";
          break;
        }
        if (result.status === "failed") {
          finalStatus = "failed";
          break;
        }
        if (result.status === "escalated") {
          finalStatus = "stalled";
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

    const behavioralForensicsSummary = OrchestratorCompanionAuditor.executeForensics(
      this.repoPath,
      {
        capsuleRunRoot: this.getCapsulePath(this.baseRunId),
        now: completedAt,
      },
    );

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
      companionPairing,
      behavioralForensicsSummary,
      ...(this.actor !== undefined ? { actor: this.actor } : {}),
    };

    const summaryPath = join(this.capsulesDir, `${this.baseRunId}-loop-summary.json`);
    writeFileSync(summaryPath, JSON.stringify(loopSummary, null, 2) + "\n", "utf-8");
    this.onLoopComplete?.(loopSummary);
    return loopSummary;
  }
}
