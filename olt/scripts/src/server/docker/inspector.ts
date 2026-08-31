/**
 * Docker container inspector for monitoring port collision hazards.
 */

import type {
  DockerConflictCheckResult,
  DockerContainerConflict,
  DockerInspectorOptions,
  DockerInspectResult,
} from "./types.ts";
import { parseDockerPsOutput } from "./parser.ts";
import { inspectContainersViaSocket, isDockerSocketPresent } from "./socket.ts";
import {
  DEFAULT_DOCKER_TIMEOUT_MS,
  defaultDockerRunner,
  execDockerAsync,
  isDockerDaemonUnavailableError,
} from "./runner.ts";

export { DEFAULT_DOCKER_TIMEOUT_MS, defaultDockerRunner, isDockerDaemonUnavailableError };

/**
 * Synchronously inspects running Docker containers via Docker CLI.
 */
export function inspectRunningContainers(
  options: DockerInspectorOptions = {},
): DockerInspectResult {
  const runner = options.runner ?? defaultDockerRunner;
  const executable = options.dockerExecutable ?? "docker";

  let res = runner(executable, ["ps", "--format", "{{json .}}", "--no-trunc"]);

  if (
    res.error !== undefined ||
    (res.status !== 0 && isDockerDaemonUnavailableError(res.stderr, res.error))
  ) {
    const errMsg = res.error?.message ?? (res.stderr.trim() || "Docker daemon unavailable");
    return { isDockerAvailable: false, isDaemonRunning: false, error: errMsg, containers: [] };
  }

  if (res.status !== 0 || (res.stdout.trim().length === 0 && res.stderr.includes("format"))) {
    const fallback = runner(executable, ["ps", "--format", "json", "--no-trunc"]);
    if (fallback.status === 0) res = fallback;
  }

  if (res.status !== 0) {
    const plain = runner(executable, ["ps", "--no-trunc"]);
    if (plain.status === 0) {
      res = plain;
    } else {
      const errMsg =
        res.stderr.trim() || plain.stderr.trim() || "Failed to inspect Docker containers";
      return { isDockerAvailable: false, isDaemonRunning: false, error: errMsg, containers: [] };
    }
  }

  return {
    isDockerAvailable: true,
    isDaemonRunning: true,
    containers: parseDockerPsOutput(res.stdout),
  };
}

/**
 * Asynchronously inspects running Docker containers via non-blocking Unix socket HTTP API first,
 * falling back to non-blocking async Docker CLI spawn execution.
 */
export async function inspectRunningContainersAsync(
  options: DockerInspectorOptions = {},
): Promise<DockerInspectResult> {
  if (options.runner !== undefined) {
    return inspectRunningContainers(options);
  }

  const socketPath = options.socketPath;
  if (isDockerSocketPresent(socketPath)) {
    const socketTimeout = options.timeoutMs !== undefined ? Math.min(options.timeoutMs, 1000) : 800;
    const socketResult = await inspectContainersViaSocket(socketPath, socketTimeout);
    if (socketResult.isDockerAvailable && socketResult.isDaemonRunning) {
      return socketResult;
    }
  }

  const executable = options.dockerExecutable ?? "docker";
  const timeoutMs = options.timeoutMs ?? DEFAULT_DOCKER_TIMEOUT_MS;

  let res = await execDockerAsync(
    executable,
    ["ps", "--format", "{{json .}}", "--no-trunc"],
    timeoutMs,
  );

  if (
    res.error !== undefined ||
    (res.status !== 0 && isDockerDaemonUnavailableError(res.stderr, res.error))
  ) {
    const errMsg = res.error?.message ?? (res.stderr.trim() || "Docker daemon unavailable");
    return { isDockerAvailable: false, isDaemonRunning: false, error: errMsg, containers: [] };
  }

  if (res.status !== 0 || (res.stdout.trim().length === 0 && res.stderr.includes("format"))) {
    const fallback = await execDockerAsync(
      executable,
      ["ps", "--format", "json", "--no-trunc"],
      timeoutMs,
    );
    if (fallback.status === 0) res = fallback;
  }

  if (res.status !== 0) {
    const plain = await execDockerAsync(executable, ["ps", "--no-trunc"], timeoutMs);
    if (plain.status === 0) {
      res = plain;
    } else {
      const errMsg =
        res.stderr.trim() || plain.stderr.trim() || "Failed to inspect Docker containers";
      return { isDockerAvailable: false, isDaemonRunning: false, error: errMsg, containers: [] };
    }
  }

  return {
    isDockerAvailable: true,
    isDaemonRunning: true,
    containers: parseDockerPsOutput(res.stdout),
  };
}

function findConflictsFromInspect(
  portList: readonly number[],
  inspectResult: DockerInspectResult,
): DockerConflictCheckResult {
  if (!inspectResult.isDockerAvailable || !inspectResult.isDaemonRunning) {
    return {
      isDockerAvailable: inspectResult.isDockerAvailable,
      checkedPorts: portList,
      hasConflict: false,
      conflicts: [],
      ...(inspectResult.error !== undefined ? { error: inspectResult.error } : {}),
    };
  }

  const conflicts: DockerContainerConflict[] = [];
  const targetPortSet = new Set(portList);

  for (const container of inspectResult.containers) {
    for (const mapping of container.portMappings) {
      if (targetPortSet.has(mapping.hostPort)) {
        conflicts.push({
          containerId: container.containerId,
          containerName: container.containerName,
          image: container.image,
          hostPort: mapping.hostPort,
          containerPort: mapping.containerPort,
          protocol: mapping.protocol,
          isOccupied: true,
          ...(mapping.hostIp ? { hostIp: mapping.hostIp } : {}),
        });
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

export function detectDockerPortConflicts(
  ports: number | readonly number[],
  options: DockerInspectorOptions = {},
): DockerConflictCheckResult {
  const portList = typeof ports === "number" ? [ports] : Array.from(ports);
  return findConflictsFromInspect(portList, inspectRunningContainers(options));
}

export async function detectDockerPortConflictsAsync(
  ports: number | readonly number[],
  options: DockerInspectorOptions = {},
): Promise<DockerConflictCheckResult> {
  const portList = typeof ports === "number" ? [ports] : Array.from(ports);
  const inspectResult = await inspectRunningContainersAsync(options);
  return findConflictsFromInspect(portList, inspectResult);
}

export function checkPortDockerCollision(
  port: number,
  options: DockerInspectorOptions = {},
): DockerContainerConflict | null {
  const result = detectDockerPortConflicts([port], options);
  return result.hasConflict && result.conflicts.length > 0 ? (result.conflicts[0] ?? null) : null;
}

export async function checkPortDockerCollisionAsync(
  port: number,
  options: DockerInspectorOptions = {},
): Promise<DockerContainerConflict | null> {
  const result = await detectDockerPortConflictsAsync([port], options);
  return result.hasConflict && result.conflicts.length > 0 ? (result.conflicts[0] ?? null) : null;
}

export function isDockerAvailable(options: DockerInspectorOptions = {}): boolean {
  const inspectResult = inspectRunningContainers(options);
  return inspectResult.isDockerAvailable && inspectResult.isDaemonRunning;
}

export async function isDockerAvailableAsync(
  options: DockerInspectorOptions = {},
): Promise<boolean> {
  const inspectResult = await inspectRunningContainersAsync(options);
  return inspectResult.isDockerAvailable && inspectResult.isDaemonRunning;
}

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

  public detectConflicts(ports: number | readonly number[]): DockerConflictCheckResult {
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
