export { ActivityTracker } from "./activity-tracker.ts";
export { AdaptiveTimerController, type IntervalAdjustmentResult } from "./adaptive-timer.ts";
export { formatCliStatusReport } from "./cli-reporter.ts";
export { WatchdogEventEmitter } from "./event-emitter.ts";
export {
  HealthAuditor,
  defaultProcessLivenessChecker,
  type HealthAuditorOptions,
} from "./health-auditor.ts";
export { normalizeReactiveTrigger, resolveTimestampMs } from "./reactive-dispatcher.ts";
export { AutonomicWatchdog } from "./watchdog-engine.ts";
export { loadWatchdogStore, saveWatchdogStore, syncWatchdogStore } from "./watchdog-store-sync.ts";

export type {
  AdaptiveAdjustmentReason,
  AdaptiveTimerConfig,
  AdaptiveTimerState,
  AgentActivityState,
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
} from "./types.ts";
