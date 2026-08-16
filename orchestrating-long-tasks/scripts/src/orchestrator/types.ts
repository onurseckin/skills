import type { JsonObject, JsonValue } from "../contracts/json.ts";
import type { FindingDetail } from "../workflow/scope-partitioner.ts";
import type { Finding, GateResult, TaskStatus } from "../contracts/workflow.ts";

export type RoundExecutionStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "rejected"
  | "escalated"
  | "stalled"
  | "skipped";

export type LoopExecutionStatus =
  | "idle"
  | "running"
  | "converged_success"
  | "max_rounds_reached"
  | "failed"
  | "stalled"
  | "aborted";

export type CriticDecision = "approve" | "request_changes" | "rejected" | "escalated";

export type AutoWakeAction = "nudge" | "reclaim_lease" | "restart_agent" | "escalate";

export type WatchdogEventType =
  | "heartbeat"
  | "heartbeat_missed"
  | "stall_detected"
  | "auto_wake"
  | "timeout"
  | "escalated"
  | "recovered";

export interface WatchdogConfig {
  readonly heartbeatTimeoutMs?: number | undefined;
  readonly idleTimeoutMs?: number | undefined;
  readonly wallClockTimeoutMs?: number | undefined;
  readonly pollIntervalMs?: number | undefined;
  readonly maxWakeRetries?: number | undefined;
  readonly autoWakeAction?: AutoWakeAction | undefined;
}

export interface WatchdogEvent {
  readonly type: WatchdogEventType;
  readonly timestamp: string;
  readonly monitorId: string;
  readonly agentId?: string | undefined;
  readonly taskId?: string | undefined;
  readonly runId?: string | undefined;
  readonly details?: string | undefined;
  readonly attempt?: number | undefined;
}

export interface MonitorState {
  readonly id: string;
  readonly agentId: string;
  readonly taskId?: string | undefined;
  readonly runId?: string | undefined;
  readonly startedAt: number;
  lastHeartbeatAt: number;
  lastActivityAt: number;
  wakeAttempts: number;
  status: "active" | "stalled" | "timed_out" | "escalated" | "closed";
}

export interface HealthCheckResult {
  readonly healthy: boolean;
  readonly activeCount: number;
  readonly stalledCount: number;
  readonly timedOutCount: number;
  readonly monitors: readonly MonitorState[];
}

export interface AutoWakeResult {
  readonly monitorId: string;
  readonly actionTaken: AutoWakeAction;
  readonly attempt: number;
  readonly succeeded: boolean;
  readonly message: string;
}

export interface DefectSynthesis {
  readonly roundNumber: number;
  readonly priorRunId: string;
  readonly originalPrompt: string;
  readonly unresolvedFindings: readonly FindingDetail[];
  readonly criticFeedback?: string | undefined;
  readonly gateFailures: readonly string[];
  readonly synthesizedPrompt: string;
  readonly affectedFiles: readonly string[];
}

export interface CapsuleChainManifest extends JsonObject {
  schema: "orchestrator.chain_manifest";
  version: number;
  sourceRunId: string;
  targetRunId: string;
  sourceCapsulePath: string;
  targetCapsulePath: string;
  roundNumber: number;
  chainedAt: string;
  carryoverRequirements: string[];
  unresolvedFindingIds: string[];
  previousEventHead: string | null;
}

export interface RoundTelemetry {
  readonly round: number;
  readonly runId: string;
  readonly status: RoundExecutionStatus;
  readonly startedAt: string;
  readonly completedAt?: string | undefined;
  readonly durationMs: number;
  readonly criticDecision?: CriticDecision | undefined;
  readonly taskCount: number;
  readonly completedTaskCount: number;
  readonly openFindingsCount: number;
  readonly resolvedFindingsCount: number;
  readonly gatesPassed: boolean;
  readonly summary?: string | undefined;
}

export interface LoopSummary {
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
  readonly finalCriticDecision?: CriticDecision | undefined;
  readonly finalMarkdownSummary: string;
}

export interface RoundExecutionInput {
  readonly round: number;
  readonly runId: string;
  readonly capsulePath: string;
  readonly prompt: string;
  readonly repoPath: string;
  readonly isFirstRound: boolean;
  readonly previousRoundRunId?: string | undefined;
  readonly priorDefects?: DefectSynthesis | undefined;
}

export interface RoundExecutionResult {
  readonly runId: string;
  readonly round: number;
  readonly status: RoundExecutionStatus;
  readonly criticDecision?: CriticDecision | undefined;
  readonly tasks: readonly {
    readonly id: string;
    readonly status: TaskStatus;
    readonly writeScope: readonly string[];
    readonly gatePassed?: boolean | undefined;
  }[];
  readonly findings: readonly Finding[];
  readonly gateResults: readonly GateResult[];
  readonly summary?: string | undefined;
  readonly logs?: readonly string[] | undefined;
}

export interface RoundExecutor {
  executeRound(input: RoundExecutionInput): Promise<RoundExecutionResult>;
}

export interface LoopRunnerOptions {
  readonly baseRunId: string;
  readonly repoPath: string;
  readonly initialPrompt: string;
  readonly maxRounds?: number | undefined; // Default 10, max 10
  readonly capsulesDir?: string | undefined;
  readonly harnessCli?: string | undefined;
  readonly actor?: string | undefined;
  readonly executor?: RoundExecutor | undefined;
  readonly watchdogConfig?: WatchdogConfig | undefined;
  readonly onRoundStart?: ((round: number, runId: string) => void) | undefined;
  readonly onRoundComplete?: ((telemetry: RoundTelemetry) => void) | undefined;
  readonly onDefectSynthesis?: ((synthesis: DefectSynthesis) => void) | undefined;
  readonly onCapsuleChained?: ((manifest: CapsuleChainManifest) => void) | undefined;
  readonly onStall?: ((event: WatchdogEvent) => void) | undefined;
  readonly onLoopComplete?: ((summary: LoopSummary) => void) | undefined;
}
