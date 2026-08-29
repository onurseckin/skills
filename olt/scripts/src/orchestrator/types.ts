import type { AgentGrantRecord } from "../core/contracts/index.ts";
import type { JsonObject, JsonValue } from "../core/contracts/index.ts";
import type { FindingDetail } from "../workflow/scope-partitioner.ts";
import type { Finding, TaskStatus } from "../core/contracts/index.ts";
import type { AuditorCursor } from "../mind/auditing/cognitive/index.ts";
import type { ForensicsIncident } from "../mind/auditing/meta/index.ts";

export type BehavioralForensicsIncident = ForensicsIncident;

export interface OrchestratorCompanionOptions {
  readonly activeAgents?: readonly AgentGrantRecord[] | undefined;
  readonly companionAgentId?: string | undefined;
  readonly strictPolicy?: boolean | undefined;
  readonly now?: string | undefined;
}

export interface CompanionPairingResult {
  readonly paired: boolean;
  readonly autoProvisioned: boolean;
  readonly isMandatoryTarget: boolean;
  readonly companionAgentId: string;
  readonly pairedAt: string;
}

export interface BehavioralForensicsOptions {
  readonly cursor?: AuditorCursor | undefined;
  readonly capsuleRunRoot?: string | undefined;
  readonly logDefects?: boolean | undefined;
  readonly now?: string | undefined;
}

export interface BehavioralForensicsReport {
  readonly compliant: boolean;
  readonly eventsAnalyzed: number;
  readonly incidents: readonly BehavioralForensicsIncident[];
  readonly tokenBurningCount: number;
  readonly falseSerializationCount: number;
  readonly roleBoundaryDeviationsCount: number;
  readonly defectsLogged: number;
  readonly cursor: AuditorCursor;
  readonly timestamp: string;
  readonly markdown: string;
}

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

export type GateRoundStatus = "passed" | "failed" | "not_run";

export type GateOverallStatus = GateRoundStatus | "partial";

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

export type WakeRequestOutcome = "wake_recorded" | "escalated" | "monitor_not_found";

export interface AutoWakeResult {
  readonly monitorId: string;
  readonly actionTaken: AutoWakeAction;
  readonly attempt: number;
  readonly outcome: WakeRequestOutcome;
  readonly dispatched: false;
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
  readonly gateStatus: GateRoundStatus;
  readonly gateCount: number;
  readonly summary?: string | undefined;
  readonly behavioralForensics?: BehavioralForensicsReport | undefined;
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
  readonly gateStatus: GateOverallStatus;
  readonly finalCriticDecision?: CriticDecision | undefined;
  readonly finalMarkdownSummary: string;
  readonly actor?: string | undefined;
  readonly companionPairing?: CompanionPairingResult | undefined;
  readonly behavioralForensicsSummary?: BehavioralForensicsReport | undefined;
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

export interface RoundGateResult {
  readonly gate_id: string;
  readonly command_id: string;
  readonly status: "passed" | "failed";
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
  readonly gateResults: readonly RoundGateResult[];
  readonly summary?: string | undefined;
  readonly logs?: readonly string[] | undefined;
  readonly behavioralForensics?: BehavioralForensicsReport | undefined;
}

export interface RoundExecutor {
  executeRound(input: RoundExecutionInput): Promise<RoundExecutionResult>;
}

export interface LoopRunnerOptions {
  readonly baseRunId: string;
  readonly repoPath: string;
  readonly initialPrompt: string;
  readonly maxRounds?: number | undefined;
  readonly capsulesDir?: string | undefined;
  readonly harnessCli?: string | undefined;
  readonly actor?: string | undefined;
  readonly executor?: RoundExecutor | undefined;
  readonly watchdogConfig?: WatchdogConfig | undefined;
  readonly skillAuditorCompanion?: boolean | undefined;
  readonly strictAuditorPolicy?: boolean | undefined;
  readonly onRoundStart?: ((round: number, runId: string) => void) | undefined;
  readonly onRoundComplete?: ((telemetry: RoundTelemetry) => void) | undefined;
  readonly onDefectSynthesis?: ((synthesis: DefectSynthesis) => void) | undefined;
  readonly onCapsuleChained?: ((manifest: CapsuleChainManifest) => void) | undefined;
  readonly onStall?: ((event: WatchdogEvent) => void) | undefined;
  readonly onLoopComplete?: ((summary: LoopSummary) => void) | undefined;
  readonly onBehavioralForensics?: ((report: BehavioralForensicsReport) => void) | undefined;
}
