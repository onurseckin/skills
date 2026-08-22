import type { MandatoryBootGate, WatchdogSeverity, WatchdogViolationType } from "./constants.ts";

export interface LiveCliProof {
  readonly gate: MandatoryBootGate;
  readonly actor: string;
  readonly argv: readonly string[];
  readonly exitCode?: number | undefined;
  readonly executedAt: string;
  readonly pid?: number | undefined;
  readonly outputSnippet?: string | undefined;
  readonly fingerprint?: string | undefined;
  readonly verified: boolean;
  readonly failureReason?: string | undefined;
}

export interface ProcessHealthStatus {
  readonly pid: number;
  readonly alive: boolean;
  readonly agentId?: string | undefined;
  readonly checkedAt: string;
  readonly error?: string | undefined;
}

export interface SubagentRegistrationOptions {
  readonly agentId: string;
  readonly role: string;
  readonly tier?: number | undefined;
  readonly parentAgentId?: string | null | undefined;
  readonly taskId?: string | null | undefined;
  readonly pid?: number | undefined;
  readonly ppid?: number | undefined;
  readonly spawnedAt?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface SubagentBootGateRecord {
  readonly agentId: string;
  readonly role: string;
  readonly tier: number;
  readonly parentAgentId: string | null;
  readonly taskId: string | null;
  readonly pid?: number | undefined;
  readonly ppid?: number | undefined;
  readonly spawnedAt: string;
  readonly whoamiExecuted: boolean;
  readonly whoamiExecutedAt: string | null;
  readonly whoamiProof?: LiveCliProof | undefined;
  readonly doctorExecuted: boolean;
  readonly doctorExecutedAt: string | null;
  readonly doctorProof?: LiveCliProof | undefined;
  readonly bootGatePassed: boolean;
  readonly gateViolations: readonly string[];
  readonly lastActivityAt: string;
  readonly lastProcessHealth?: ProcessHealthStatus | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface BootGateVerificationResult {
  readonly passed: boolean;
  readonly missingGates: readonly MandatoryBootGate[];
  readonly violations: readonly string[];
  readonly proofs?: Readonly<Partial<Record<MandatoryBootGate, LiveCliProof>>> | undefined;
  readonly record?: SubagentBootGateRecord | undefined;
}

export interface WatchdogFinding {
  readonly id: string;
  readonly agentId?: string | undefined;
  readonly role?: string | undefined;
  readonly taskId?: string | undefined;
  readonly violationType: WatchdogViolationType;
  readonly severity: WatchdogSeverity;
  readonly observation: string;
  readonly remediation: string;
  readonly timestamp: string;
  readonly evidence?: Readonly<Record<string, unknown>> | undefined;
}

export interface WatchdogHealthAuditReport {
  readonly healthy: boolean;
  readonly timestamp: string;
  readonly activeLeasesCount: number;
  readonly stalledAgentsCount: number;
  readonly deadProcessesCount: number;
  readonly subagentCount: number;
  readonly bootGateCompliantCount: number;
  readonly bootGateViolationsCount: number;
  readonly tierViolationsCount: number;
  readonly findings: readonly WatchdogFinding[];
  readonly summary: string;
}

export interface WatchdogTickReport {
  readonly tickCount: number;
  readonly timestamp: string;
  readonly elapsedMs: number;
  readonly intervalMs: number;
  readonly health: WatchdogHealthAuditReport;
}

export type AdaptiveAdjustmentReason =
  | "initial"
  | "activity_burst"
  | "idle_backoff"
  | "manual_reset"
  | "event_wakeup";

export interface AdaptiveTimerConfig {
  readonly enabled?: boolean | undefined;
  readonly minIntervalMs?: number | undefined;
  readonly maxIntervalMs?: number | undefined;
  readonly backoffFactor?: number | undefined;
  readonly activityBoost?: number | undefined;
  readonly initialIntervalMs?: number | undefined;
}

export interface AdaptiveTimerState {
  readonly enabled: boolean;
  readonly currentIntervalMs: number;
  readonly minIntervalMs: number;
  readonly maxIntervalMs: number;
  readonly backoffFactor: number;
  readonly activityBoost: number;
  readonly lastAdjustmentReason: AdaptiveAdjustmentReason;
  readonly lastAdjustedAt: string;
}

export interface ReactiveEvent {
  readonly type: string;
  readonly source?: string | undefined;
  readonly taskId?: string | null | undefined;
  readonly agentId?: string | null | undefined;
  readonly timestamp?: string | number | Date | undefined;
  readonly payload?: Readonly<Record<string, unknown>> | undefined;
}

export type ReactiveWakeupTrigger = string | ReactiveEvent;

export type WatchdogEvent =
  | { readonly type: "tick"; readonly report: WatchdogTickReport }
  | { readonly type: "health_audit"; readonly report: WatchdogHealthAuditReport }
  | {
      readonly type: "boot_gate_violation";
      readonly record: SubagentBootGateRecord;
      readonly finding: WatchdogFinding;
    }
  | {
      readonly type: "stall_detected";
      readonly agentId: string;
      readonly finding: WatchdogFinding;
    }
  | {
      readonly type: "process_failure_detected";
      readonly agentId: string;
      readonly pid: number;
      readonly finding: WatchdogFinding;
    }
  | {
      readonly type: "critical_violation";
      readonly finding: WatchdogFinding;
    }
  | {
      readonly type: "reactive_wakeup";
      readonly trigger: ReactiveEvent;
      readonly tickReport: WatchdogTickReport;
    }
  | {
      readonly type: "interval_adjusted";
      readonly previousIntervalMs: number;
      readonly newIntervalMs: number;
      readonly reason: AdaptiveAdjustmentReason;
      readonly state: AdaptiveTimerState;
    }
  | {
      readonly type: "event_notified";
      readonly event: ReactiveEvent;
    };

export type WatchdogEventListener = (event: WatchdogEvent | ReactiveEvent) => void | Promise<void>;

export interface AutonomicWatchdogConfig {
  readonly heartbeatIntervalMs?: number | undefined;
  readonly timeoutMs?: number | undefined;
  readonly healthAuditIntervalMs?: number | undefined;
  readonly processHealthCheckIntervalMs?: number | undefined;
  readonly initialStartedAt?: number | string | Date | undefined;
  readonly capsuleRoot?: string | undefined;
  readonly generation?: number | undefined;
  readonly pulseId?: string | null | undefined;
  readonly enforcePreFlightGates?: boolean | undefined;
  readonly processLivenessChecker?: ((pid: number) => boolean) | undefined;
  readonly onHeartbeat?: ((tick: WatchdogTickReport) => void | Promise<void>) | undefined;
  readonly onHealthAudit?: ((audit: WatchdogHealthAuditReport) => void | Promise<void>) | undefined;
  readonly onViolation?: ((finding: WatchdogFinding) => void | Promise<void>) | undefined;
  readonly onReactiveWakeup?: ((trigger: ReactiveEvent, tick: WatchdogTickReport) => void | Promise<void>) | undefined;
  readonly onIntervalAdjusted?: ((state: AdaptiveTimerState) => void | Promise<void>) | undefined;
  readonly adaptive?: boolean | AdaptiveTimerConfig | undefined;
  readonly minIntervalMs?: number | undefined;
  readonly maxIntervalMs?: number | undefined;
  readonly backoffFactor?: number | undefined;
  readonly activityBoost?: number | undefined;
}
