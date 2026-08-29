export type {
  CleanupPreviousPhaseOptions,
  CleanupStaleOptions,
  CleanupStaleResult,
  HeartbeatOptions,
  ListWatchdogOptions,
  RegisterWatchdogOptions,
  RegisterWatchdogResult,
  TerminateOptions,
  TerminatePhaseOptions,
  TerminatePhaseResult,
  VerifyWatchdogResult,
  WatchdogRecord,
  WatchdogStatus,
  WatchdogStore,
  WatchdogViolation,
} from "./types.ts";

export {
  DEFAULT_HEARTBEAT_CADENCE_MS,
  DEFAULT_WATCHDOG_TIMEOUT_MS,
  WATCHDOG_STATUSES,
} from "./constants.ts";

export {
  acquireExclusiveLock,
  activeWatchdogAuthorityPaths,
  activeWatchdogLockInodes,
  activeWatchdogLockParents,
  activeWatchdogLockPaths,
  activeWatchdogLockRoots,
  activeWatchdogRootInodes,
  activeWatchdogRootPaths,
  assertCurrentLockAuthority,
  assertRealDirectory,
  openVerifiedParent,
  requiredNoFollowFlag,
  sameInode,
  setWatchdogLockTimingForTesting,
  watchdogAuthorityRoot,
  watchdogLockRetryMs,
  watchdogLockTimeoutMs,
  withWatchdogStoreLock,
} from "./lock.ts";

export {
  createDefaultWatchdogStore,
  generateWatchdogId,
  isJsonValue,
  isRecord,
  isWatchdogStatus,
  loadWatchdogStore,
  loadWatchdogStoreUnlocked,
  parseTimestamp,
  requireNonEmptyString,
  requireNullableString,
  requirePositiveSafeInteger,
  requireTimestamp,
  resolveApiNow,
  resolveWatchdogStorePath,
  saveWatchdogStore,
  saveWatchdogStoreUnlocked,
  timestampMilliseconds,
  validateMetadata,
  validateWatchdogRecord,
  validateWatchdogStore,
} from "./store.ts";

export {
  heartbeatWatchdog,
  heartbeatWatchdogUnlocked,
  registerWatchdog,
  registerWatchdogUnlocked,
  terminateWatchdog,
  terminateWatchdogUnlocked,
} from "./ops-registration.ts";

export {
  cleanupPreviousPhaseWatchdogs,
  cleanupPreviousPhaseWatchdogsUnlocked,
  cleanupStaleWatchdogs,
  cleanupStaleWatchdogsUnlocked,
  listWatchdogs,
  terminatePhaseWatchdogs,
  terminatePhaseWatchdogsUnlocked,
} from "./ops-cleanup.ts";

export {
  renderAsciiWatchdogTable,
  verifyWatchdogLifecycle,
} from "./verify.ts";
