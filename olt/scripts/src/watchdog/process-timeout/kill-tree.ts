export function defaultKillProcessTree(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

export async function executeSignalEscalation(
  targetPid: number | undefined,
  graceMs: number,
  recordedSignals: NodeJS.Signals[],
  killFn: (pid: number, signal: NodeJS.Signals) => boolean,
  waitFn: (milliseconds: number) => Promise<unknown>,
): Promise<readonly NodeJS.Signals[]> {
  if (targetPid === undefined || !Number.isSafeInteger(targetPid) || targetPid <= 1) {
    return [...recordedSignals];
  }

  if (graceMs > 0) {
    try {
      const termDelivered = killFn(targetPid, "SIGTERM");
      if (termDelivered) {
        recordedSignals.push("SIGTERM");
      }
    } catch {
      // ESRCH or other error ignored
    }
    await waitFn(graceMs);
  }

  try {
    const killDelivered = killFn(targetPid, "SIGKILL");
    if (killDelivered) {
      recordedSignals.push("SIGKILL");
    }
  } catch {
    // ESRCH or other error ignored
  }

  return [...recordedSignals];
}
