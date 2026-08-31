export { HierarchicalStallProbe, createHierarchicalStallProbe } from "./hierarchical-probe.ts";

export {
  OWNERSHIP_ENV,
  linuxPipeHandles,
  linuxPipeOwners,
  linuxProcessIdentity,
  linuxTokenOwnerIdentities,
  parseLinuxProcessIdentity,
} from "./linux-pipes.ts";

export {
  signalProcessGroup,
  terminateProcessGroup,
  type ProcessGroupIdentity,
} from "./process-group.ts";

export {
  readProcessIdentity,
  sameProcessIdentity,
  type ProcessIdentity,
  type ProcessTopology,
} from "./process-identity.ts";

export {
  DEFAULT_DIAGNOSTIC_TAIL_BYTES,
  DEFAULT_GRACE_PERIOD_MS,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_STALL_PROGRESS_THRESHOLD_MS,
  ERROR_CLASS_IDLE_TIMEOUT,
  ERROR_CLASS_PROCESS_HANG,
  ERROR_CLASS_STALL_TIMEOUT,
  ERROR_CLASS_WALL_TIMEOUT,
  ERROR_CLASS_ZOMBIE_PROCESS,
  EXIT_STATUS_EXIT_FAILURE,
  EXIT_STATUS_EXIT_SUCCESS,
  EXIT_STATUS_SIGKILL_TIMEOUT,
  EXIT_STATUS_SIGTERM_TIMEOUT,
  ProcessTimeoutWatchdog,
  buildRemediationGuidance,
  createProcessTimeoutWatchdog,
  type ChildNodeInfo,
  type ErrorClassification,
  type ExitStatus,
  type HierarchicalRole,
  type HierarchicalStallProbeOptions,
  type ProbeResult,
  type ProcessDiagnostics,
  type ProcessWatchdogOptions,
  type RemediationGuidance,
  type StructuredFailurePayload,
  type SupervisorTier,
  type WatchdogLivenessReport,
  type WatchdogMonitorResult,
  type WatchdogTimeoutKind,
} from "./process-timeout-watchdog.ts";

export { ancestry, matchesTopology, processSnapshot } from "./process-tree.ts";

export {
  checkWatchdogLiveness,
  synthesizeWatchdogFailurePayload,
  type CheckLivenessOptions,
  type SynthesizePayloadContext,
} from "./watchdog-failure-payload.ts";

export { runWatchdogMonitoringLoop } from "./watchdog-monitor.ts";

import * as darwin from "./darwin/index.ts";

export { darwin };
