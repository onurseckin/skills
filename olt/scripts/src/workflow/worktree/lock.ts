import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";

export const DEFAULT_LOCK_TIMEOUT_MS = 5000;
export const STALE_LOCK_THRESHOLD_MS = 60_000;
export const IN_FLIGHT_LOCK_GRACE_MS = 2000;

export interface LockPayload {
  trackId: string;
  pid: number;
  createdAt: string;
  tier?: string | undefined;
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    return (err as { code?: string })?.code === "EPERM";
  }
}

export function sleepSync(ms: number): void {
  if (ms <= 0) return;
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {}
  }
}

export function readLockPayload(lockPath: string): LockPayload | null {
  if (!existsSync(lockPath)) return null;
  try {
    const raw = readFileSync(lockPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && typeof parsed.pid === "number") {
      return parsed as LockPayload;
    }
    return null;
  } catch {
    return null;
  }
}

export function acquireWorktreeLock(
  lockPath: string,
  identifier: string,
  timeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
  tier = "track",
): void {
  mkdirSync(dirname(lockPath), { recursive: true });
  const startTime = Date.now();
  let backoffMs = 10;
  while (true) {
    if (existsSync(lockPath)) {
      try {
        const raw = readFileSync(lockPath, "utf-8");
        const fileStat = statSync(lockPath);
        let isStale = false;
        try {
          const payload: LockPayload = JSON.parse(raw);
          const age = Date.now() - new Date(payload.createdAt).getTime();
          if (
            !isProcessAlive(payload.pid) ||
            (Number.isFinite(age) && age > STALE_LOCK_THRESHOLD_MS)
          ) {
            isStale = true;
          }
        } catch {
          if (Date.now() - fileStat.mtimeMs > IN_FLIGHT_LOCK_GRACE_MS) {
            isStale = true;
          }
        }
        if (isStale) {
          try {
            unlinkSync(lockPath);
          } catch {}
        }
      } catch {}
    }
    try {
      const payload: LockPayload = {
        trackId: identifier,
        pid: process.pid,
        createdAt: new Date().toISOString(),
        tier,
      };
      writeFileSync(lockPath, JSON.stringify(payload), { flag: "wx" });
      return;
    } catch {
      const elapsed = Date.now() - startTime;
      if (elapsed >= timeoutMs) {
        throw new HarnessError(
          "LOCK_TIMEOUT",
          `Worktree lock for '${identifier}' could not be acquired within ${timeoutMs}ms`,
        );
      }
      sleepSync(Math.min(backoffMs, timeoutMs - elapsed));
      backoffMs = Math.min(backoffMs * 2, 100);
    }
  }
}

export function acquireTrackLock(
  lockPath: string,
  trackId: string,
  timeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
): void {
  acquireWorktreeLock(lockPath, trackId, timeoutMs, "track");
}

export function acquireOrchestratorLock(
  lockPath: string,
  domain: string,
  timeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
): void {
  acquireWorktreeLock(lockPath, domain, timeoutMs, "orchestrator");
}

export function releaseWorktreeLock(lockPath: string): void {
  if (existsSync(lockPath)) {
    try {
      unlinkSync(lockPath);
    } catch {}
  }
}

export function releaseTrackLock(lockPath: string): void {
  releaseWorktreeLock(lockPath);
}

export function releaseOrchestratorLock(lockPath: string): void {
  releaseWorktreeLock(lockPath);
}
