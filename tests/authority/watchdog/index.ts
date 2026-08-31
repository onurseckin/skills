/**
 * Authority Watchdog Subdomain Test Facade.
 * Explicit named exports for watchdog stores, locks, lifecycles, and verification.
 */

export {
  loadWatchdogStore,
  saveWatchdogStore,
  resolveWatchdogStorePath,
  createDefaultWatchdogStore,
  registerWatchdog,
  heartbeatWatchdog,
  terminateWatchdog,
  terminatePhaseWatchdogs,
  cleanupPreviousPhaseWatchdogs,
  cleanupStaleWatchdogs,
  listWatchdogs,
  verifyWatchdogLifecycle,
  renderAsciiWatchdogTable,
  parseTimestamp,
  withWatchdogStoreLock,
  setWatchdogLockTimingForTesting,
  DEFAULT_HEARTBEAT_CADENCE_MS,
  DEFAULT_WATCHDOG_TIMEOUT_MS,
  type WatchdogRecord,
  type WatchdogStore,
  type WatchdogPhase,
  type WatchdogStatus,
} from "../../../olt/scripts/src/authority/watchdog/index.ts";
