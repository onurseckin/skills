/**
 * Dev Server Lifecycle & State Preservation Subsystem.
 *
 * Provides dev server lifecycle coordination, atomic restart locking, state snapshot
 * preservation (active endpoints, environment variables, PID history, port configurations,
 * run flags), graceful SIGTERM/SIGKILL shutdown, and transactional rollback on failure.
 */

export type {
  LockHandle,
  LockOptions,
  PortConfiguration,
  RestartOptions,
  RestartResult,
  ServerEndpoint,
  ServerStartOptions,
  ServerStartResult,
  ServerStateRestoreResult,
  ServerStateSnapshot,
  ServerStateSnapshotInput,
  ShutdownOptions,
  ShutdownResult,
  ShutdownSignal,
} from "./types.ts";

export {
  ALLOWED_ENV_VARS,
  CREDENTIAL_PATTERNS,
  DEFAULT_SNAPSHOT_PATH,
  LEGACY_SNAPSHOT_PATH,
  StatePreserver,
  captureServerStateSnapshot,
  captureSnapshot,
  clearSnapshot,
  createStatePreserver,
  isCredentialValue,
  isValidServerStateSnapshot,
  loadSnapshot,
  purgeLegacySnapshot,
  saveSnapshot,
  type SnapshotFsPorts,
} from "./snapshot.ts";

export {
  DEFAULT_LOCK_PATH,
  DEFAULT_LOCK_TIMEOUT_MS,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_STALE_LOCK_AGE_MS,
  ServerLockError,
  acquireLock,
  forceReleaseLock,
  isLocked,
  releaseLock,
  withRestartLock,
} from "./lock.ts";

export {
  DEFAULT_GRACE_PERIOD_MS,
  DEFAULT_SHUTDOWN_POLL_INTERVAL_MS,
  shutdownProcess,
} from "./shutdown.ts";

export {
  DEFAULT_BIND_POLL_INTERVAL_MS,
  DEFAULT_BIND_TIMEOUT_MS,
  checkTcpPort,
  startServer,
} from "./starter.ts";

export {
  DevServerLifecycleManager,
  createServerLifecycleManager,
  restartDevServer,
} from "./coordinator.ts";
