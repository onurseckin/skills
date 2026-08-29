export {
  DEFAULT_DIAGNOSTIC_TAIL_BYTES,
  DEFAULT_GRACE_PERIOD_MS,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_STALL_PROGRESS_THRESHOLD_MS,
  DEFAULT_TEST_IDLE_TIMEOUT_MS,
  DEFAULT_TEST_WALL_TIMEOUT_MS,
  ERROR_CLASS_IDLE_TIMEOUT,
  ERROR_CLASS_PROCESS_HANG,
  ERROR_CLASS_STALL_TIMEOUT,
  ERROR_CLASS_WALL_TIMEOUT,
  ERROR_CLASS_ZOMBIE_PROCESS,
  EXIT_STATUS_EXIT_FAILURE,
  EXIT_STATUS_EXIT_SUCCESS,
  EXIT_STATUS_SIGKILL_MANUAL,
  EXIT_STATUS_SIGKILL_TIMEOUT,
  EXIT_STATUS_SIGTERM_TIMEOUT,
} from "./constants.ts";

export { buildRemediationGuidance } from "./remediation.ts";
export { buildProcessDiagnostics, trimChunks } from "./diagnostics.ts";
export { defaultKillProcessTree, executeSignalEscalation } from "./kill-tree.ts";
export { evaluateProcessLiveness } from "./liveness.ts";
export { monitorSubprocessLoop } from "./monitor.ts";
export { ProcessTimeoutWatchdog, createProcessTimeoutWatchdog } from "./runner.ts";
export { HierarchicalStallProbe, createHierarchicalStallProbe } from "./probe.ts";

export type {
  BunSubprocess,
  ChildNodeInfo,
  ErrorClassification,
  ExitStatus,
  HierarchicalRole,
  HierarchicalStallProbeOptions,
  ProbeResult,
  ProcessDiagnostics,
  ProcessWatchdogOptions,
  RemediationGuidance,
  StructuredFailurePayload,
  SupervisorTier,
  WatchdogLivenessReport,
  WatchdogMonitorResult,
  WatchdogTimeoutKind,
} from "./types.ts";
