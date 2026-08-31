/**
 * Safe process reclaimer with graceful SIGTERM escalation, SIGKILL fallback, and EPERM fast-fail.
 */

import {
  findPidsOnPort,
  getProcessDetails,
  inspectPortOccupancy,
  inspectProcessesOnPorts,
} from "./inspector.ts";
import type {
  PortProcessOccupancy,
  ProcessDetails,
  ProcessInspectorOptions,
  ReclaimOptions,
  ReclaimResult,
  ReclaimSignal,
} from "./types.ts";

export function defaultIsProcessAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && "code" in err) {
      const nodeErr = err as { code?: string };
      if (nodeErr.code === "EPERM") return true;
      if (nodeErr.code === "ESRCH") return false;
    }
    return false;
  }
}

export function defaultSignalSender(pid: number, signal: "SIGTERM" | "SIGKILL"): boolean {
  if (pid <= 0) return false;
  let killed = false;
  let hasEperm = false;

  try {
    process.kill(-pid, signal);
    killed = true;
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "EPERM") {
      hasEperm = true;
    }
  }

  try {
    process.kill(pid, signal);
    killed = true;
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "EPERM") {
      hasEperm = true;
    }
  }

  if (!killed && hasEperm) {
    const error = new Error(`EPERM: operation not permitted, kill ${pid}`);
    (error as Error & { code: string }).code = "EPERM";
    throw error;
  }

  return killed;
}

export function defaultSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Safely reclaims a process occupying a port with EPERM fast-fail.
 */
export async function reclaimProcess(
  pid: number,
  port: number,
  options?: ReclaimOptions & ProcessInspectorOptions,
): Promise<ReclaimResult> {
  const startTs = performance.now();
  const isAlive = options?.isAliveChecker ?? defaultIsProcessAlive;
  const sendSignal = options?.signalSender ?? defaultSignalSender;
  const sleep = options?.sleepFn ?? defaultSleep;
  const gracePeriodMs = options?.gracePeriodMs ?? 1000;
  const pollIntervalMs = options?.pollIntervalMs ?? 50;

  if (!isAlive(pid)) {
    return {
      pid,
      name: "unknown",
      port,
      reclaimed: true,
      signalSent: "NONE",
      durationMs: Math.round(performance.now() - startTs),
    };
  }

  const details = await getProcessDetails(pid, options);
  const processName = details?.name && details.name.length > 0 ? details.name : `pid-${pid}`;

  if (options?.dryRun) {
    return {
      pid,
      name: processName,
      port,
      reclaimed: false,
      signalSent: "NONE",
      durationMs: Math.round(performance.now() - startTs),
    };
  }

  const triggerSignal = (sig: "SIGTERM" | "SIGKILL"): { ok: boolean; eperm: boolean } => {
    try {
      const ok = sendSignal(pid, sig);
      return { ok, eperm: false };
    } catch (err: unknown) {
      if (
        (typeof err === "object" && err !== null && (err as { code?: string }).code === "EPERM") ||
        (err instanceof Error && err.message.includes("EPERM"))
      ) {
        return { ok: false, eperm: true };
      }
      return { ok: false, eperm: false };
    }
  };

  if (options?.force) {
    const sigRes = triggerSignal("SIGKILL");
    if (sigRes.eperm) {
      return {
        pid,
        name: processName,
        port,
        reclaimed: false,
        signalSent: "SIGKILL",
        durationMs: Math.round(performance.now() - startTs),
        error: `Permission denied to signal process ${pid} (${processName}) (EPERM)`,
      };
    }
    await sleep(Math.min(100, gracePeriodMs));
    const deadAfterKill = !isAlive(pid);
    return {
      pid,
      name: processName,
      port,
      reclaimed: deadAfterKill,
      signalSent: "SIGKILL",
      durationMs: Math.round(performance.now() - startTs),
      error: deadAfterKill ? undefined : `Failed to terminate process ${pid} under force SIGKILL`,
    };
  }

  let signalSent: ReclaimSignal = "SIGTERM";
  const termRes = triggerSignal("SIGTERM");
  if (termRes.eperm) {
    return {
      pid,
      name: processName,
      port,
      reclaimed: false,
      signalSent: "SIGTERM",
      durationMs: Math.round(performance.now() - startTs),
      error: `Permission denied to signal process ${pid} (${processName}) (EPERM)`,
    };
  }

  const termDeadline = Date.now() + gracePeriodMs;
  let terminated = false;

  while (Date.now() < termDeadline) {
    await sleep(pollIntervalMs);
    if (!isAlive(pid)) {
      terminated = true;
      break;
    }
  }

  if (!terminated && isAlive(pid)) {
    signalSent = "SIGKILL";
    const killRes = triggerSignal("SIGKILL");
    if (killRes.eperm) {
      return {
        pid,
        name: processName,
        port,
        reclaimed: false,
        signalSent: "SIGKILL",
        durationMs: Math.round(performance.now() - startTs),
        error: `Permission denied to signal process ${pid} (${processName}) (EPERM)`,
      };
    }
    const killDeadline = Date.now() + Math.min(500, gracePeriodMs);
    while (Date.now() < killDeadline) {
      await sleep(pollIntervalMs);
      if (!isAlive(pid)) {
        terminated = true;
        break;
      }
    }
    terminated = !isAlive(pid);
  }

  return {
    pid,
    name: processName,
    port,
    reclaimed: terminated,
    signalSent,
    durationMs: Math.round(performance.now() - startTs),
    error: terminated
      ? undefined
      : `Process ${pid} (${processName}) did not respond to SIGTERM or SIGKILL escalation within timeout`,
  };
}

export async function reclaimPort(
  port: number,
  options?: ReclaimOptions & ProcessInspectorOptions,
): Promise<ReclaimResult[]> {
  const pids = await findPidsOnPort(port, options);
  if (pids.length === 0) return [];
  const results: ReclaimResult[] = [];
  for (const pid of pids) {
    results.push(await reclaimProcess(pid, port, options));
  }
  return results;
}

export async function reclaimZombieProcesses(
  ports: readonly number[],
  options?: ReclaimOptions & ProcessInspectorOptions,
): Promise<ReclaimResult[]> {
  const results: ReclaimResult[] = [];
  const occupancies = await inspectProcessesOnPorts(ports, options);

  for (const occupancy of occupancies) {
    for (const proc of occupancy.processes) {
      const shouldReclaim =
        proc.isZombie || proc.isOrphaned || proc.isRuntimeProcess || Boolean(options?.force);

      if (shouldReclaim) {
        results.push(await reclaimProcess(proc.pid, occupancy.port, options));
      }
    }
  }

  return results;
}

export class ProcessReclaimer {
  private readonly defaultOptions: ReclaimOptions & ProcessInspectorOptions;

  constructor(options?: ReclaimOptions & ProcessInspectorOptions) {
    this.defaultOptions = options ?? {};
  }

  public async findPidsOnPort(port: number): Promise<number[]> {
    return await findPidsOnPort(port, this.defaultOptions);
  }

  public async getProcessDetails(pid: number): Promise<ProcessDetails | null> {
    return await getProcessDetails(pid, this.defaultOptions);
  }

  public async inspectPort(port: number): Promise<PortProcessOccupancy> {
    return await inspectPortOccupancy(port, this.defaultOptions);
  }

  public async inspectPorts(ports: readonly number[]): Promise<PortProcessOccupancy[]> {
    return await inspectProcessesOnPorts(ports, this.defaultOptions);
  }

  public async reclaim(
    pid: number,
    port: number,
    overrideOptions?: ReclaimOptions,
  ): Promise<ReclaimResult> {
    return await reclaimProcess(pid, port, { ...this.defaultOptions, ...overrideOptions });
  }

  public async reclaimPort(
    port: number,
    overrideOptions?: ReclaimOptions,
  ): Promise<ReclaimResult[]> {
    return await reclaimPort(port, { ...this.defaultOptions, ...overrideOptions });
  }

  public async reclaimZombies(
    ports: readonly number[],
    overrideOptions?: ReclaimOptions,
  ): Promise<ReclaimResult[]> {
    return await reclaimZombieProcesses(ports, { ...this.defaultOptions, ...overrideOptions });
  }
}
