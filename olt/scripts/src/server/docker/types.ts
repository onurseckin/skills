/**
 * Port protocol identifier (e.g., 'tcp', 'udp', 'sctp').
 */
export type PortProtocol = "tcp" | "udp" | "sctp" | string;

/**
 * Parsed individual port mapping from a Docker container to the host.
 */
export interface DockerPortMapping {
  readonly hostIp?: string;
  readonly hostPort: number;
  readonly containerPort: number;
  readonly protocol: PortProtocol;
}

/**
 * Structured details of a running Docker container.
 */
export interface DockerContainerInfo {
  readonly containerId: string;
  readonly containerName: string;
  readonly image: string;
  readonly status?: string;
  readonly state?: string;
  readonly portMappings: readonly DockerPortMapping[];
  readonly rawPorts?: string;
}

/**
 * Structured details of a port collision between a dev server host port and a Docker container.
 */
export interface DockerContainerConflict {
  readonly containerId: string;
  readonly containerName: string;
  readonly image: string;
  readonly hostPort: number;
  readonly containerPort: number;
  readonly protocol: string;
  readonly isOccupied: boolean;
  readonly hostIp?: string;
}

/**
 * Result of inspecting running Docker containers.
 */
export interface DockerInspectResult {
  readonly isDockerAvailable: boolean;
  readonly isDaemonRunning: boolean;
  readonly error?: string;
  readonly containers: readonly DockerContainerInfo[];
}

/**
 * Result of checking for Docker port conflicts against specified host ports.
 */
export interface DockerConflictCheckResult {
  readonly isDockerAvailable: boolean;
  readonly checkedPorts: readonly number[];
  readonly hasConflict: boolean;
  readonly conflicts: readonly DockerContainerConflict[];
  readonly error?: string;
}

/**
 * Subprocess execution result for Docker CLI runner.
 */
export interface DockerRunnerResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: Error | undefined;
}

/**
 * Runner function signature for executing Docker commands.
 */
export type DockerRunner = (command: string, args: readonly string[]) => DockerRunnerResult;

/**
 * Options for configuring DockerInspector.
 */
export interface DockerInspectorOptions {
  readonly dockerExecutable?: string;
  readonly socketPath?: string;
  readonly timeoutMs?: number;
  readonly runner?: DockerRunner;
}
