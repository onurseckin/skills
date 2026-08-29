import type { ProcessDiagnostics } from "./types.ts";

export function trimChunks(chunks: string[], maxTailBytes: number): void {
  let combinedLength = 0;
  for (let i = chunks.length - 1; i >= 0; i--) {
    const chunk = chunks[i];
    if (chunk !== undefined) {
      combinedLength += chunk.length;
      if (combinedLength > maxTailBytes && i > 0) {
        chunks.splice(0, i);
        break;
      }
    }
  }
}

export function buildProcessDiagnostics(params: {
  stdoutChunks: readonly string[];
  stderrChunks: readonly string[];
  totalStdoutBytes: number;
  totalStderrBytes: number;
  maxTailBytes: number;
  startedAtMs: number;
  lastActivityAtMs: number;
  lastProgressAtMs: number;
  lastHeartbeatAtMs: number;
  signalsSent: readonly NodeJS.Signals[];
  pid?: number | undefined;
  ppid?: number | undefined;
  nowMs: number;
}): ProcessDiagnostics {
  const stdoutTail = params.stdoutChunks.join("").slice(-params.maxTailBytes);
  const stderrTail = params.stderrChunks.join("").slice(-params.maxTailBytes);

  return {
    stdoutTail,
    stderrTail,
    stdoutBytes: params.totalStdoutBytes,
    stderrBytes: params.totalStderrBytes,
    lastActivityAt: new Date(params.lastActivityAtMs).toISOString(),
    lastProgressAt: new Date(params.lastProgressAtMs).toISOString(),
    lastHeartbeatAt: new Date(params.lastHeartbeatAtMs).toISOString(),
    durationMs: Math.max(0, params.nowMs - params.startedAtMs),
    idleDurationMs: Math.max(0, params.nowMs - params.lastActivityAtMs),
    progressStallDurationMs: Math.max(0, params.nowMs - params.lastProgressAtMs),
    ...(params.pid !== undefined ? { pid: params.pid } : {}),
    ...(params.ppid !== undefined ? { ppid: params.ppid } : {}),
    signalsSent: [...params.signalsSent],
  };
}
