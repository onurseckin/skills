/**
 * Smart Dev Server Port Conflict Guard & Server Lifecycle Subsystem.
 *
 * Unifies probe, docker, process, and lifecycle subsystems with explicit named facades.
 */

// Probe Subsystem
export type {
  ComprehensivePortStatus,
  ConflictDetectionOptions,
  IpFamily,
  MultiProbeOptions,
  ProbeOptions,
  ProbeStatus,
  SocketConflictResult,
  SocketConflictStatus,
  TcpProbeResult,
} from "./probe/index.ts";

export {
  COMMON_INTERFACES,
  DEFAULT_PROBE_HOST,
  DEFAULT_PROBE_TIMEOUT_MS,
  checkPortAvailability,
  chunkArray,
  detectInterfaceConflicts,
  detectSocketConflict,
  findAvailablePort,
  inspectComprehensivePort,
  isIpv6,
  isPortInUse,
  normalizeHost,
  probeAddressFamilies,
  probeAllInterfaces,
  probePorts,
  probeTcpPort,
  resolveFamily,
  validatePort,
} from "./probe/index.ts";

// Docker Subsystem
export type {
  DockerConflictCheckResult,
  DockerContainerConflict,
  DockerContainerInfo,
  DockerInspectorOptions,
  DockerInspectResult,
  DockerPortMapping,
  DockerRunner,
  DockerRunnerResult,
  PortProtocol,
} from "./docker/index.ts";

export {
  DEFAULT_DOCKER_SOCKET_PATH,
  DEFAULT_DOCKER_TIMEOUT_MS,
  DockerInspector,
  checkPortDockerCollision,
  checkPortDockerCollisionAsync,
  defaultDockerRunner,
  detectDockerPortConflicts,
  detectDockerPortConflictsAsync,
  getCandidateSocketPaths,
  inspectContainersViaSocket,
  inspectRunningContainers,
  inspectRunningContainersAsync,
  isDockerAvailable,
  isDockerAvailableAsync,
  isDockerDaemonUnavailableError,
  isDockerSocketPresent,
  normalizeContainerRecord,
  parseApiPortsArray,
  parseDockerPortMappings,
  parseDockerPsOutput,
  parsePortRange,
  parseSingleDockerPortMapping,
  parseTableLine,
  resolveDockerSocketPath,
} from "./docker/index.ts";

// Process Subsystem
export type {
  CommandExecutionResult,
  CommandExecutor,
  PortProcessOccupancy,
  ProcessDetails,
  ProcessInspectorOptions,
  ReclaimOptions,
  ReclaimResult,
  ReclaimSignal,
} from "./process/index.ts";

export {
  ProcessReclaimer,
  RUNTIME_IDENTIFIERS,
  defaultCommandExecutor,
  defaultIsProcessAlive,
  defaultSignalSender,
  defaultSleep,
  extractProcessName,
  findPidsOnPort,
  getProcessDetails,
  inspectPortOccupancy,
  inspectProcessesOnPorts,
  isRuntimeProcessCommand,
  parseFuserOutput,
  parseLsofOutput,
  parsePsOutput,
  parseSsOutput,
  reclaimPort,
  reclaimProcess,
  reclaimZombieProcesses,
} from "./process/index.ts";

// Lifecycle Subsystem
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
  SnapshotFsPorts,
} from "./lifecycle/index.ts";

export {
  ALLOWED_ENV_VARS,
  CREDENTIAL_PATTERNS,
  DEFAULT_BIND_POLL_INTERVAL_MS,
  DEFAULT_BIND_TIMEOUT_MS,
  DEFAULT_GRACE_PERIOD_MS,
  DEFAULT_LOCK_PATH,
  DEFAULT_LOCK_TIMEOUT_MS,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_SHUTDOWN_POLL_INTERVAL_MS,
  DEFAULT_SNAPSHOT_PATH,
  DEFAULT_STALE_LOCK_AGE_MS,
  DevServerLifecycleManager,
  LEGACY_SNAPSHOT_PATH,
  ServerLockError,
  StatePreserver,
  acquireLock,
  captureServerStateSnapshot,
  captureSnapshot,
  checkTcpPort,
  clearSnapshot,
  createServerLifecycleManager,
  createStatePreserver,
  forceReleaseLock,
  isCredentialValue,
  isLocked,
  isValidServerStateSnapshot,
  loadSnapshot,
  purgeLegacySnapshot,
  releaseLock,
  restartDevServer,
  saveSnapshot,
  shutdownProcess,
  startServer,
  withRestartLock,
} from "./lifecycle/index.ts";
