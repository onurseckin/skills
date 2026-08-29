export const DEFAULT_HEARTBEAT_INTERVAL_MS = 1_000;
export const DEFAULT_STALL_PROGRESS_THRESHOLD_MS = 60_000;
export const DEFAULT_GRACE_PERIOD_MS = 1_000;
export const DEFAULT_DIAGNOSTIC_TAIL_BYTES = 64 * 1024;

export const EXIT_STATUS_SIGKILL_TIMEOUT = "SIGKILL_TIMEOUT";
export const EXIT_STATUS_SIGTERM_TIMEOUT = "SIGTERM_TIMEOUT";
export const EXIT_STATUS_EXIT_FAILURE = "EXIT_FAILURE";
export const EXIT_STATUS_EXIT_SUCCESS = "EXIT_SUCCESS";

export const ERROR_CLASS_STALL_TIMEOUT = "STALL_TIMEOUT";
export const ERROR_CLASS_WALL_TIMEOUT = "WALL_TIMEOUT";
export const ERROR_CLASS_IDLE_TIMEOUT = "IDLE_TIMEOUT";
export const ERROR_CLASS_PROCESS_HANG = "PROCESS_HANG";
export const ERROR_CLASS_ZOMBIE_PROCESS = "ZOMBIE_PROCESS";

export type SupervisorTier = "mind" | "orchestrator" | "coordinator" | "implementer" | "critic";

export type HierarchicalRole =
  | "mind"
  | "orchestrator"
  | "coordinator"
  | "task_implementer"
  | "completeness_critic"
  | "implementer"
  | "critic"
  | "worker";

export type WatchdogTimeoutKind = "idle" | "wall" | "stall" | "zombie";

export type ErrorClassification =
  | "STALL_TIMEOUT"
  | "WALL_TIMEOUT"
  | "IDLE_TIMEOUT"
  | "PROCESS_HANG"
  | "ZOMBIE_PROCESS";

export type ExitStatus =
  | "SIGKILL_TIMEOUT"
  | "SIGTERM_TIMEOUT"
  | "SIGKILL_MANUAL"
  | "EXIT_FAILURE"
  | "EXIT_SUCCESS";

export interface ProcessDiagnostics {
  readonly stdoutTail: string;
  readonly stderrTail: string;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly lastActivityAt: string | null;
  readonly lastProgressAt: string | null;
  readonly lastHeartbeatAt: string | null;
  readonly durationMs: number;
  readonly idleDurationMs: number;
  readonly progressStallDurationMs: number;
  readonly pid?: number;
  readonly ppid?: number;
  readonly signalsSent: readonly NodeJS.Signals[];
}

export interface RemediationGuidance {
  readonly action:
    | "autonomous_repair_routing"
    | "retry_with_backoff"
    | "escalate_to_supervisor"
    | "reassign_scope";
  readonly summary: string;
  readonly prescribedSteps: readonly string[];
  readonly defectReference: "defect-20260822-24" | "defect-20260822-28" | string;
  readonly supervisorTarget?: string;
  readonly fallbackDirective?: string;
}

export interface StructuredFailurePayload {
  readonly schema: "harness.structured_failure_payload";
  readonly version: 1;
  readonly exitStatus: ExitStatus | string;
  readonly errorClassification: ErrorClassification | string;
  readonly reason: string;
  readonly taskId?: string | null;
  readonly gateId?: string | null;
  readonly agentId?: string | null;
  readonly supervisorTier?: SupervisorTier | string;
  readonly childRole?: HierarchicalRole | string;
  readonly childPid?: number;
  readonly diagnostics: ProcessDiagnostics;
  readonly remediationGuidance: RemediationGuidance;
  readonly timestamp: string;
}

export interface ProcessWatchdogOptions {
  readonly pid?: number | undefined;
  readonly ppid?: number | undefined;
  readonly taskId?: string | undefined;
  readonly gateId?: string | undefined;
  readonly agentId?: string | undefined;
  readonly supervisorTier?: SupervisorTier | undefined;
  readonly childRole?: HierarchicalRole | undefined;
  readonly wallTimeoutMs?: number | undefined;
  readonly idleTimeoutMs?: number | undefined;
  readonly stallProgressThresholdMs?: number | undefined;
  readonly heartbeatIntervalMs?: number | undefined;
  readonly graceMs?: number | undefined;
  readonly maxTailBytes?: number | undefined;
  readonly startedAt?: number | undefined;
  readonly killProcessTree?: (pid: number, signal: NodeJS.Signals) => boolean;
  readonly wait?: (milliseconds: number) => Promise<unknown>;
  readonly now?: () => number;
}

export interface WatchdogLivenessReport {
  readonly alive: boolean;
  readonly timedOut: boolean;
  readonly stalled: boolean;
  readonly timeoutKind: WatchdogTimeoutKind | null;
  readonly errorClassification?: ErrorClassification;
  readonly reason?: string;
}

export interface WatchdogMonitorResult {
  readonly outcome: "exit" | "timeout" | "stall" | "interrupted";
  readonly exitCode: number | null;
  readonly failurePayload?: StructuredFailurePayload;
  readonly signalsSent: readonly NodeJS.Signals[];
}

export interface ChildNodeInfo {
  readonly childId: string;
  readonly role: HierarchicalRole | string;
  readonly supervisorTier: SupervisorTier | string;
  readonly pid?: number;
  readonly ppid?: number;
  readonly taskId?: string;
  readonly gateId?: string;
  readonly agentId?: string;
  readonly wallTimeoutMs?: number;
  readonly idleTimeoutMs?: number;
  readonly stallProgressThresholdMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly graceMs?: number;
  readonly startedAt?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ProbeResult {
  readonly childId: string;
  readonly role: HierarchicalRole | string;
  readonly supervisorTier: SupervisorTier | string;
  readonly pid?: number | undefined;
  readonly alive: boolean;
  readonly stalled: boolean;
  readonly timedOut: boolean;
  readonly reason?: string | undefined;
  readonly errorClassification?: ErrorClassification | undefined;
  readonly lastHeartbeatAgeMs: number;
  readonly lastProgressAgeMs: number;
  readonly durationMs: number;
  readonly failurePayload?: StructuredFailurePayload | undefined;
}

export interface HierarchicalStallProbeOptions {
  readonly supervisorTier: SupervisorTier;
  readonly supervisorId?: string;
  readonly defaultWallTimeoutMs?: number;
  readonly defaultIdleTimeoutMs?: number;
  readonly defaultStallThresholdMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly graceMs?: number;
  readonly maxTailBytes?: number;
  readonly now?: () => number;
  readonly killProcessTree?: (pid: number, signal: NodeJS.Signals) => boolean;
  readonly wait?: (milliseconds: number) => Promise<unknown>;
}
