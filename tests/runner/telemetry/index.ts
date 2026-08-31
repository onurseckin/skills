/**
 * Runner Telemetry Subdomain Test Facade.
 * Explicit named exports for process monitoring, activity recording, and watchdog lifecycles.
 */

export {
  monitorProcess,
  type ProcessMonitorResult,
} from "../../../olt/scripts/src/engine/runner/telemetry/watchdog.ts";

export {
  activityMetadata,
  type ActivityMetadata,
} from "../../../olt/scripts/src/engine/runner/telemetry/activity.ts";

export {
  ProcessTimeoutWatchdog,
} from "../../../olt/scripts/src/engine/runner/telemetry/process-timeout-watchdog.ts";
