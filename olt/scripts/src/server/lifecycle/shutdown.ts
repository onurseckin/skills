/**
 * Graceful Server Process Shutdown Subsystem.
 *
 * Coordinates graceful SIGTERM shutdown with automatic SIGKILL escalation
 * for old or hanging dev server processes.
 */

import type { ShutdownOptions, ShutdownResult, ShutdownSignal } from "./types.ts";

export const DEFAULT_GRACE_PERIOD_MS = 2000;
export const DEFAULT_SHUTDOWN_POLL_INTERVAL_MS = 50;

function defaultIsAlive(pid: number): boolean {
  if (pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function defaultSignalSender(pid: number, signal: "SIGTERM" | "SIGKILL"): boolean {
  if (pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Shuts down a process gracefully using SIGTERM, escalating to SIGKILL if necessary.
 */
export async function shutdownProcess(
  pid: number,
  options?: ShutdownOptions,
): Promise<ShutdownResult> {
  const startTime = Date.now();

  let gracePeriodMs = DEFAULT_GRACE_PERIOD_MS;
  if (options !== undefined && options !== null && typeof options.gracePeriodMs === "number") {
    gracePeriodMs = options.gracePeriodMs;
  }

  let pollIntervalMs = DEFAULT_SHUTDOWN_POLL_INTERVAL_MS;
  if (options !== undefined && options !== null && typeof options.pollIntervalMs === "number") {
    pollIntervalMs = options.pollIntervalMs;
  }

  let isAlive = defaultIsAlive;
  if (options !== undefined && options !== null && options.isAliveChecker !== undefined) {
    isAlive = options.isAliveChecker;
  }

  let sendSignal = defaultSignalSender;
  if (options !== undefined && options !== null && options.signalSender !== undefined) {
    sendSignal = options.signalSender;
  }

  let sleep = defaultSleep;
  if (options !== undefined && options !== null && options.sleepFn !== undefined) {
    sleep = options.sleepFn;
  }

  if (pid <= 0) {
    return {
      pid,
      stopped: true,
      signalSent: "NONE",
      durationMs: 0,
    };
  }

  const currentlyAlive = isAlive(pid);
  if (!currentlyAlive) {
    return {
      pid,
      stopped: true,
      signalSent: "NONE",
      durationMs: Date.now() - startTime,
    };
  }

  // Step 1: Send SIGTERM
  let signalSent: ShutdownSignal = "SIGTERM";
  sendSignal(pid, "SIGTERM");

  // Step 2: Poll during grace period
  const termDeadline = Date.now() + gracePeriodMs;
  while (Date.now() < termDeadline) {
    const aliveCheck = isAlive(pid);
    if (!aliveCheck) {
      return {
        pid,
        stopped: true,
        signalSent,
        durationMs: Date.now() - startTime,
      };
    }
    await sleep(pollIntervalMs);
  }

  // Step 3: Check if stopped; if not, escalate to SIGKILL
  const stillAlive = isAlive(pid);
  if (!stillAlive) {
    return {
      pid,
      stopped: true,
      signalSent,
      durationMs: Date.now() - startTime,
    };
  }

  signalSent = "SIGKILL";
  sendSignal(pid, "SIGKILL");

  // Step 4: Wait up to 1000ms after SIGKILL
  const killDeadline = Date.now() + 1000;
  while (Date.now() < killDeadline) {
    const afterKillAlive = isAlive(pid);
    if (!afterKillAlive) {
      return {
        pid,
        stopped: true,
        signalSent,
        durationMs: Date.now() - startTime,
      };
    }
    await sleep(pollIntervalMs);
  }

  const finalAlive = isAlive(pid);
  let finalError: string | undefined = undefined;
  if (finalAlive) {
    finalError = `Process ${pid} refused to terminate after SIGKILL escalation.`;
  }

  return {
    pid,
    stopped: !finalAlive,
    signalSent,
    durationMs: Date.now() - startTime,
    error: finalError,
  };
}
