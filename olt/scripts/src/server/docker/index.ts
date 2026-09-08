/**
 * Docker Container & Port Conflict Subsystem.
 *
 * Provides inspection of running Docker containers, socket discovery,
 * port collision detection, and Docker CLI/socket communication.
 */

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
} from "./types.ts";

export {
  normalizeContainerRecord,
  parseApiPortsArray,
  parseDockerPortMappings,
  parseDockerPsOutput,
  parsePortRange,
  parseSingleDockerPortMapping,
  parseTableLine,
} from "./parser.ts";

export {
  DEFAULT_DOCKER_SOCKET_PATH,
  getCandidateSocketPaths,
  inspectContainersViaSocket,
  isDockerSocketPresent,
  resolveDockerSocketPath,
} from "./socket.ts";

export {
  checkPortDockerCollision,
  checkPortDockerCollisionAsync,
  DEFAULT_DOCKER_TIMEOUT_MS,
  defaultDockerRunner,
  detectDockerPortConflicts,
  detectDockerPortConflictsAsync,
  DockerInspector,
  inspectRunningContainers,
  inspectRunningContainersAsync,
  isDockerAvailable,
  isDockerAvailableAsync,
  isDockerDaemonUnavailableError,
} from "./inspector.ts";
