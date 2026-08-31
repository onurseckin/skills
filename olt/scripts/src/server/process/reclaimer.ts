/**
 * Safe process reclaimer with graceful SIGTERM escalation and SIGKILL fallback.
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
      if (nodeErr.code === "EPERM") {
        return true;
      }
      if (nodeErr.code === "ESRCH") {
        return false;
      }
    }
    return false;
  }
}

export function defaultSignalSender(pid: number, signal: "SIGTERM" | "SIGKILL"): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

export function defaultSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Safely reclaims a process occupying a port.
 *
 * 1. Checks if process is alive. If already dead, returns immediately.
 * 2. In dry-run mode, returns simulated outcome without sending signals.
 * 3. In force mode, immediately sends SIGKILL.
 * 4. In standard mode, sends SIGTERM and polls until gracePeriod expires;
 *    if process is still alive, escalates to SIGKILL.
 */
export async function reclaimProcess(
  pid: number,
  port: number,
  options?: ReclaimOptions & ProcessInspectorOptions,
): Promise<ReclaimResult> {
  const startTs = performance.now();
  const isAlive =
    typeof options !== "undefined" && typeof options.isAliveChecker === "function"
      ? options.isAliveChecker
      : defaultIsProcessAlive;
  const sendSignal =
    typeof options !== "undefined" && typeof options.signalSender === "function"
      ? options.signalSender
      : defaultSignalSender;
  const sleep =
    typeof options !== "undefined" && typeof options.sleepFn === "function"
      ? options.sleepFn
      : defaultSleep;
  const gracePeriodMs =
    typeof options !== "undefined" && typeof options.gracePeriodMs === "number"
      ? options.gracePeriodMs
      : 1000;
  const pollIntervalMs =
    typeof options !== "undefined" && typeof options.pollIntervalMs === "number"
      ? options.pollIntervalMs
      : 50;

  // Check if process exists
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

  // Retrieve process details for reporting
  const details = await getProcessDetails(pid, options);
  const processName =
    details !== null && typeof details.name === "string" && details.name.length > 0
      ? details.name
      : `pid-${pid}`;

  // Handle dry-run mode
  if (typeof options !== "undefined" && Boolean(options.dryRun)) {
    return {
      pid,
      name: processName,
      port,
      reclaimed: false,
      signalSent: "NONE",
      durationMs: Math.round(performance.now() - startTs),
    };
  }

  // Handle force mode (immediate SIGKILL)
  if (typeof options !== "undefined" && Boolean(options.force)) {
    sendSignal(pid, "SIGKILL");
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

  // Standard graceful escalation: SIGTERM -> wait -> SIGKILL
  let signalSent: ReclaimSignal = "SIGTERM";
  sendSignal(pid, "SIGTERM");

  const termDeadline = Date.now() + gracePeriodMs;
  let terminated = false;

  while (Date.now() < termDeadline) {
    await sleep(pollIntervalMs);
    if (!isAlive(pid)) {
      terminated = true;
      break;
    }
  }

  // If still running after grace period, escalate to SIGKILL
  if (!terminated && isAlive(pid)) {
    signalSent = "SIGKILL";
    sendSignal(pid, "SIGKILL");
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

/**
 * Inspects port and reclaims all processes listening on it.
 */
export async function reclaimPort(
  port: number,
  options?: ReclaimOptions & ProcessInspectorOptions,
): Promise<ReclaimResult[]> {
  const pids = await findPidsOnPort(port, options);
  if (pids.length === 0) return [];

  const results: ReclaimResult[] = [];
  for (const pid of pids) {
    const res = await reclaimProcess(pid, port, options);
    results.push(res);
  }
  return results;
}

/**
 * Reclaims orphaned or zombie Node/Bun/server processes occupying the given ports.
 */
export async function reclaimZombieProcesses(
  ports: readonly number[],
  options?: ReclaimOptions & ProcessInspectorOptions,
): Promise<ReclaimResult[]> {
  const results: ReclaimResult[] = [];
  const occupancies = await inspectProcessesOnPorts(ports, options);

  for (const occupancy of occupancies) {
    for (const proc of occupancy.processes) {
      let shouldReclaim = false;
      if (proc.isZombie) {
        shouldReclaim = true;
      } else if (proc.isOrphaned) {
        shouldReclaim = true;
      } else if (proc.isRuntimeProcess) {
        shouldReclaim = true;
      } else if (typeof options !== "undefined" && Boolean(options.force)) {
        shouldReclaim = true;
      }

      if (shouldReclaim) {
        const res = await reclaimProcess(proc.pid, occupancy.port, options);
        results.push(res);
      }
    }
  }

  return results;
}

/**
 * ProcessReclaimer class encapsulating inspection and reclamation logic.
 */
export class ProcessReclaimer {
  private readonly defaultOptions: ReclaimOptions & ProcessInspectorOptions;

  constructor(options?: ReclaimOptions & ProcessInspectorOptions) {
    this.defaultOptions = typeof options !== "undefined" ? options : {};
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
    const merged: ReclaimOptions & ProcessInspectorOptions = Object.assign(
      {},
      this.defaultOptions,
      typeof overrideOptions !== "undefined" ? overrideOptions : {},
    );
    return await reclaimProcess(pid, port, merged);
  }

  public async reclaimPort(
    port: number,
    overrideOptions?: ReclaimOptions,
  ): Promise<ReclaimResult[]> {
    const merged: ReclaimOptions & ProcessInspectorOptions = Object.assign(
      {},
      this.defaultOptions,
      typeof overrideOptions !== "undefined" ? overrideOptions : {},
    );
    return await reclaimPort(port, merged);
  }

  public async reclaimZombies(
    ports: readonly number[],
    overrideOptions?: ReclaimOptions,
  ): Promise<ReclaimResult[]> {
    const merged: ReclaimOptions & ProcessInspectorOptions = Object.assign(
      {},
      this.defaultOptions,
      typeof overrideOptions !== "undefined" ? overrideOptions : {},
    );
    return await reclaimZombieProcesses(ports, merged);
  }
}
