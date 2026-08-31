import { spawnSync } from "node:child_process";
import type {
  DockerConflictCheckResult,
  DockerContainerConflict,
  DockerInspectorOptions,
  DockerInspectResult,
  DockerRunner,
  DockerRunnerResult,
} from "./types.ts";
import { parseDockerPsOutput } from "./parser.ts";
import { inspectContainersViaSocket, isDockerSocketPresent } from "./socket.ts";

/**
 * Default timeout in milliseconds for Docker CLI invocations.
 */
export const DEFAULT_DOCKER_TIMEOUT_MS = 4000;

/**
 * Standard synchronous Docker CLI runner using node:child_process.spawnSync.
 */
export const defaultDockerRunner: DockerRunner = (
  command: string,
  args: readonly string[],
): DockerRunnerResult => {
  try {
    const result = spawnSync(command, Array.from(args), {
      timeout: DEFAULT_DOCKER_TIMEOUT_MS,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (result.error !== undefined) {
      const statusVal = result.status !== null && result.status !== undefined ? result.status : null;
      const stdoutVal = result.stdout !== null && result.stdout !== undefined ? result.stdout : "";
      const stderrVal = result.stderr !== null && result.stderr !== undefined ? result.stderr : "";
      return {
        status: statusVal,
        stdout: stdoutVal,
        stderr: stderrVal,
        error: result.error,
      };
    }

    const statusVal = result.status !== null && result.status !== undefined ? result.status : 0;
    const stdoutVal = result.stdout !== null && result.stdout !== undefined ? result.stdout : "";
    const stderrVal = result.stderr !== null && result.stderr !== undefined ? result.stderr : "";

    return {
      status: statusVal,
      stdout: stdoutVal,
      stderr: stderrVal,
    };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return {
      status: null,
      stdout: "",
      stderr: error.message,
      error,
    };
  }
};

/**
 * Checks whether an error or stderr message indicates Docker daemon absence or disconnect.
 */
export function isDockerDaemonUnavailableError(
  stderr: string,
  error?: Error | undefined,
): boolean {
  if (error !== undefined) {
    const errorObj = error as unknown as Record<string, unknown>;
    const code = errorObj["code"];
    if (code === "ENOENT") return true;
    if (code === "ECONNREFUSED") return true;
    if (code === "ETIMEDOUT") return true;

    const msg = error.message.toLowerCase();
    if (msg.includes("enoent")) return true;
    if (msg.includes("econnrefused")) return true;
    if (msg.includes("etimedout")) return true;
    if (msg.includes("cannot connect to the docker daemon")) return true;
    if (msg.includes("is the docker daemon running")) return true;
    if (msg.includes("command not found")) return true;
  }

  const lower = stderr.toLowerCase();
  if (lower.includes("cannot connect to the docker daemon")) return true;
  if (lower.includes("is the docker daemon running")) return true;
  if (lower.includes("docker: command not found")) return true;
  if (lower.includes("command not found")) return true;
  if (lower.includes("no such file or directory")) return true;
  if (lower.includes("error during connect")) return true;
  if (lower.includes("permission denied")) return true;
  if (lower.includes("daemon is not running")) return true;
  if (lower.includes("connection refused")) return true;

  return false;
}

/**
 * Synchronously inspects running Docker containers via Docker CLI.
 * Gracefully handles daemon absence, missing docker binary, and CLI errors without throwing.
 */
export function inspectRunningContainers(
  options: DockerInspectorOptions = {},
): DockerInspectResult {
  const runner = options.runner !== undefined ? options.runner : defaultDockerRunner;
  const executable = options.dockerExecutable !== undefined ? options.dockerExecutable : "docker";

  // Try 1: `docker ps --format "{{json .}}" --no-trunc`
  let res = runner(executable, ["ps", "--format", "{{json .}}", "--no-trunc"]);

  // If binary missing or daemon unavailable on first try
  const isErr = res.error !== undefined;
  const isNonZeroUnavailable = res.status !== 0 && isDockerDaemonUnavailableError(res.stderr, res.error);

  if (isErr) {
    let errMsg = "Docker daemon unavailable";
    if (res.error !== undefined) {
      errMsg = res.error.message;
    } else if (res.stderr.trim().length > 0) {
      errMsg = res.stderr.trim();
    }
    return {
      isDockerAvailable: false,
      isDaemonRunning: false,
      error: errMsg,
      containers: [],
    };
  }
  if (isNonZeroUnavailable) {
    let errMsg = "Docker daemon unavailable";
    if (res.stderr.trim().length > 0) {
      errMsg = res.stderr.trim();
    }
    return {
      isDockerAvailable: false,
      isDaemonRunning: false,
      error: errMsg,
      containers: [],
    };
  }

  // Try 2: `docker ps --format json --no-trunc` (modern Docker CLI format fallback)
  let shouldTryJsonFallback = false;
  if (res.status !== 0) {
    shouldTryJsonFallback = true;
  } else if (res.stdout.trim().length === 0 && res.stderr.includes("format")) {
    shouldTryJsonFallback = true;
  }

  if (shouldTryJsonFallback) {
    const fallbackRes = runner(executable, ["ps", "--format", "json", "--no-trunc"]);
    if (fallbackRes.status === 0) {
      res = fallbackRes;
    }
  }

  // Try 3: `docker ps` plain fallback
  if (res.status !== 0) {
    const plainRes = runner(executable, ["ps", "--no-trunc"]);
    if (plainRes.status === 0) {
      res = plainRes;
    } else {
      let errMsg = "Failed to inspect Docker containers";
      if (res.stderr.trim().length > 0) {
        errMsg = res.stderr.trim();
      } else if (plainRes.stderr.trim().length > 0) {
        errMsg = plainRes.stderr.trim();
      }
      return {
        isDockerAvailable: false,
        isDaemonRunning: false,
        error: errMsg,
        containers: [],
      };
    }
  }

  const containers = parseDockerPsOutput(res.stdout);

  return {
    isDockerAvailable: true,
    isDaemonRunning: true,
    containers,
  };
}

/**
 * Asynchronously inspects running Docker containers via CLI with socket fallback.
 */
export async function inspectRunningContainersAsync(
  options: DockerInspectorOptions = {},
): Promise<DockerInspectResult> {
  const syncResult = inspectRunningContainers(options);
  if (syncResult.isDockerAvailable && syncResult.isDaemonRunning) {
    return syncResult;
  }

  // If CLI inspection failed and a socket is present, try direct socket HTTP API
  if (isDockerSocketPresent(options.socketPath)) {
    const timeout = options.timeoutMs !== undefined ? options.timeoutMs : DEFAULT_DOCKER_TIMEOUT_MS;
    const socketResult = await inspectContainersViaSocket(
      options.socketPath,
      timeout,
    );
    if (socketResult.isDockerAvailable && socketResult.isDaemonRunning) {
      return socketResult;
    }
  }

  return syncResult;
}

/**
 * Identifies potential port collisions between specified host ports and running Docker containers.
 */
export function detectDockerPortConflicts(
  ports: number | readonly number[],
  options: DockerInspectorOptions = {},
): DockerConflictCheckResult {
  const portList: readonly number[] =
    typeof ports === "number" ? [ports] : Array.from(ports);

  const inspectResult = inspectRunningContainers(options);

  if (!inspectResult.isDockerAvailable) {
    const failResult: {
      isDockerAvailable: boolean;
      checkedPorts: readonly number[];
      hasConflict: boolean;
      conflicts: readonly DockerContainerConflict[];
      error?: string;
    } = {
      isDockerAvailable: false,
      checkedPorts: portList,
      hasConflict: false,
      conflicts: [],
    };
    if (inspectResult.error !== undefined) {
      failResult.error = inspectResult.error;
    }
    return failResult;
  }

  if (!inspectResult.isDaemonRunning) {
    const failResult: {
      isDockerAvailable: boolean;
      checkedPorts: readonly number[];
      hasConflict: boolean;
      conflicts: readonly DockerContainerConflict[];
      error?: string;
    } = {
      isDockerAvailable: false,
      checkedPorts: portList,
      hasConflict: false,
      conflicts: [],
    };
    if (inspectResult.error !== undefined) {
      failResult.error = inspectResult.error;
    }
    return failResult;
  }

  const conflicts: DockerContainerConflict[] = [];
  const targetPortSet = new Set(portList);

  for (const container of inspectResult.containers) {
    for (const mapping of container.portMappings) {
      if (targetPortSet.has(mapping.hostPort)) {
        const item: {
          containerId: string;
          containerName: string;
          image: string;
          hostPort: number;
          containerPort: number;
          protocol: string;
          isOccupied: boolean;
          hostIp?: string;
        } = {
          containerId: container.containerId,
          containerName: container.containerName,
          image: container.image,
          hostPort: mapping.hostPort,
          containerPort: mapping.containerPort,
          protocol: mapping.protocol,
          isOccupied: true,
        };
        if (mapping.hostIp !== undefined && mapping.hostIp.length > 0) {
          item.hostIp = mapping.hostIp;
        }
        conflicts.push(item);
      }
    }
  }

  return {
    isDockerAvailable: true,
    checkedPorts: portList,
    hasConflict: conflicts.length > 0,
    conflicts,
  };
}

/**
 * Asynchronously identifies potential port collisions between specified host ports and running Docker containers.
 */
export async function detectDockerPortConflictsAsync(
  ports: number | readonly number[],
  options: DockerInspectorOptions = {},
): Promise<DockerConflictCheckResult> {
  const portList: readonly number[] =
    typeof ports === "number" ? [ports] : Array.from(ports);

  const inspectResult = await inspectRunningContainersAsync(options);

  if (!inspectResult.isDockerAvailable) {
    const failResult: {
      isDockerAvailable: boolean;
      checkedPorts: readonly number[];
      hasConflict: boolean;
      conflicts: readonly DockerContainerConflict[];
      error?: string;
    } = {
      isDockerAvailable: false,
      checkedPorts: portList,
      hasConflict: false,
      conflicts: [],
    };
    if (inspectResult.error !== undefined) {
      failResult.error = inspectResult.error;
    }
    return failResult;
  }

  if (!inspectResult.isDaemonRunning) {
    const failResult: {
      isDockerAvailable: boolean;
      checkedPorts: readonly number[];
      hasConflict: boolean;
      conflicts: readonly DockerContainerConflict[];
      error?: string;
    } = {
      isDockerAvailable: false,
      checkedPorts: portList,
      hasConflict: false,
      conflicts: [],
    };
    if (inspectResult.error !== undefined) {
      failResult.error = inspectResult.error;
    }
    return failResult;
  }

  const conflicts: DockerContainerConflict[] = [];
  const targetPortSet = new Set(portList);

  for (const container of inspectResult.containers) {
    for (const mapping of container.portMappings) {
      if (targetPortSet.has(mapping.hostPort)) {
        const item: {
          containerId: string;
          containerName: string;
          image: string;
          hostPort: number;
          containerPort: number;
          protocol: string;
          isOccupied: boolean;
          hostIp?: string;
        } = {
          containerId: container.containerId,
          containerName: container.containerName,
          image: container.image,
          hostPort: mapping.hostPort,
          containerPort: mapping.containerPort,
          protocol: mapping.protocol,
          isOccupied: true,
        };
        if (mapping.hostIp !== undefined && mapping.hostIp.length > 0) {
          item.hostIp = mapping.hostIp;
        }
        conflicts.push(item);
      }
    }
  }

  return {
    isDockerAvailable: true,
    checkedPorts: portList,
    hasConflict: conflicts.length > 0,
    conflicts,
  };
}

/**
 * Checks if a single host port collides with any running Docker container.
 * Returns the conflict details if collision detected, or null otherwise.
 */
export function checkPortDockerCollision(
  port: number,
  options: DockerInspectorOptions = {},
): DockerContainerConflict | null {
  const result = detectDockerPortConflicts([port], options);
  if (
    result.hasConflict &&
    result.conflicts.length > 0 &&
    result.conflicts[0] !== undefined
  ) {
    return result.conflicts[0];
  }
  return null;
}

/**
 * Asynchronously checks if a single host port collides with any running Docker container.
 */
export async function checkPortDockerCollisionAsync(
  port: number,
  options: DockerInspectorOptions = {},
): Promise<DockerContainerConflict | null> {
  const result = await detectDockerPortConflictsAsync([port], options);
  if (
    result.hasConflict &&
    result.conflicts.length > 0 &&
    result.conflicts[0] !== undefined
  ) {
    return result.conflicts[0];
  }
  return null;
}

/**
 * Checks whether the Docker daemon is accessible and running synchronously.
 */
export function isDockerAvailable(options: DockerInspectorOptions = {}): boolean {
  const inspectResult = inspectRunningContainers(options);
  return inspectResult.isDockerAvailable && inspectResult.isDaemonRunning;
}

/**
 * Checks whether the Docker daemon is accessible and running asynchronously.
 */
export async function isDockerAvailableAsync(
  options: DockerInspectorOptions = {},
): Promise<boolean> {
  const inspectResult = await inspectRunningContainersAsync(options);
  return inspectResult.isDockerAvailable && inspectResult.isDaemonRunning;
}

/**
 * Object-oriented Docker container inspector for monitoring port collision hazards.
 */
export class DockerInspector {
  private readonly options: DockerInspectorOptions;

  constructor(options: DockerInspectorOptions = {}) {
    this.options = options;
  }

  public isAvailable(): boolean {
    return isDockerAvailable(this.options);
  }

  public isAvailableAsync(): Promise<boolean> {
    return isDockerAvailableAsync(this.options);
  }

  public inspect(): DockerInspectResult {
    return inspectRunningContainers(this.options);
  }

  public inspectAsync(): Promise<DockerInspectResult> {
    return inspectRunningContainersAsync(this.options);
  }

  public detectConflicts(
    ports: number | readonly number[],
  ): DockerConflictCheckResult {
    return detectDockerPortConflicts(ports, this.options);
  }

  public detectConflictsAsync(
    ports: number | readonly number[],
  ): Promise<DockerConflictCheckResult> {
    return detectDockerPortConflictsAsync(ports, this.options);
  }

  public checkPort(port: number): DockerContainerConflict | null {
    return checkPortDockerCollision(port, this.options);
  }

  public checkPortAsync(port: number): Promise<DockerContainerConflict | null> {
    return checkPortDockerCollisionAsync(port, this.options);
  }
}
