import type {
  AdaptiveAdjustmentReason,
  AdaptiveTimerConfig,
  AdaptiveTimerState,
  AutonomicWatchdogConfig,
  LiveCliProof,
  ProcessHealthStatus,
  ReactiveEvent,
  ReactiveWakeupTrigger,
  SubagentBootGateRecord,
  SubagentRegistrationOptions,
  WatchdogEvent,
  WatchdogEventListener,
  WatchdogFinding,
  WatchdogHealthAuditReport,
  WatchdogTickReport,
} from "../types.ts";

export interface AgentActivityState {
  readonly agentId: string;
  readonly taskId: string | null;
  readonly pid?: number | undefined;
  readonly lastHeartbeatAt: number;
  readonly lastActivityAt: number;
  readonly status: "active" | "stalled";
  readonly lastProcessHealth?: ProcessHealthStatus | undefined;
}

export type {
  AdaptiveAdjustmentReason,
  AdaptiveTimerConfig,
  AdaptiveTimerState,
  AutonomicWatchdogConfig,
  LiveCliProof,
  ProcessHealthStatus,
  ReactiveEvent,
  ReactiveWakeupTrigger,
  SubagentBootGateRecord,
  SubagentRegistrationOptions,
  WatchdogEvent,
  WatchdogEventListener,
  WatchdogFinding,
  WatchdogHealthAuditReport,
  WatchdogTickReport,
};
