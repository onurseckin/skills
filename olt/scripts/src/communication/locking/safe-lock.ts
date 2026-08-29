import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeSync,
  type Stats,
} from "node:fs";
import { dirname, join } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { releaseFlock, tryExclusiveFlock } from "../../platform/index.ts";
import type { LockAcquisitionResult, LockPayload } from "../types.ts";

export const DEFAULT_LOCK_TIMEOUT_MS = 10_000;
export const DEFAULT_STALE_THRESHOLD_MS = 10_000;
export const DEFAULT_RETRY_INTERVAL_MS = 25;

export interface SafeLockOptions {
  readonly timeoutMs?: number;
  readonly staleThresholdMs?: number;
  readonly retryMs?: number;
}

export type LockOptions = SafeLockOptions;

export function delay(milliseconds: number): void {
  if (milliseconds <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return (error as { code?: string })?.code === "EPERM";
  }
}

export function parseLockPayload(content: string): LockPayload | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (
      typeof parsed["pid"] === "number" &&
      Number.isInteger(parsed["pid"]) &&
      typeof parsed["holder"] === "string" &&
      typeof parsed["created_at"] === "string"
    ) {
      return { pid: parsed["pid"], holder: parsed["holder"], created_at: parsed["created_at"] };
    }
    return null;
  } catch {
    return null;
  }
}

function readHolderPid(lockPath: string): number | null {
  try {
    if (!existsSync(lockPath)) return null;
    return parseLockPayload(readFileSync(lockPath, "utf8"))?.pid ?? null;
  } catch {
    return null;
  }
}

function validateOptions(options?: SafeLockOptions): {
  timeoutMs: number;
  staleThresholdMs: number;
  retryMs: number;
} {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new HarnessError("INVALID_ARGUMENT", "timeoutMs must be finite and non-negative");
  }
  const staleThresholdMs = options?.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS;
  if (!Number.isFinite(staleThresholdMs) || staleThresholdMs < 0) {
    throw new HarnessError("INVALID_ARGUMENT", "staleThresholdMs must be finite and non-negative");
  }
  const retryMs = options?.retryMs ?? DEFAULT_RETRY_INTERVAL_MS;
  if (!Number.isFinite(retryMs) || retryMs < 0) {
    throw new HarnessError("INVALID_ARGUMENT", "retryMs must be finite and non-negative");
  }
  return { timeoutMs, staleThresholdMs, retryMs };
}

export function acquireMailboxLock(
  lockPath: string,
  agentId: string,
  options?: SafeLockOptions,
): LockAcquisitionResult {
  if (!lockPath || typeof lockPath !== "string") {
    throw new HarnessError("INVALID_ARGUMENT", "lockPath must be a non-empty string");
  }
  if (!agentId || typeof agentId !== "string") {
    throw new HarnessError("INVALID_ARGUMENT", "agentId must be a non-empty string");
  }
  const { timeoutMs, retryMs } = validateOptions(options);
  const lockDir = dirname(lockPath);
  if (!existsSync(lockDir)) {
    try {
      mkdirSync(lockDir, { recursive: true, mode: 0o700 });
    } catch (error) {
      throw new HarnessError(
        "INTEGRITY",
        `failed to create lock directory '${lockDir}': ${String(error)}`,
      );
    }
  }

  let descriptor: number | undefined;
  try {
    descriptor = openSync(lockPath, constants.O_RDWR | constants.O_CREAT, 0o644);
  } catch (error) {
    throw new HarnessError("INTEGRITY", `failed to open lock file '${lockPath}': ${String(error)}`);
  }

  const deadline = performance.now() + timeoutMs;
  let acquired = false;
  try {
    while (!(acquired = tryExclusiveFlock(descriptor))) {
      const remaining = deadline - performance.now();
      if (remaining <= 0) {
        const holderPid = readHolderPid(lockPath);
        closeSync(descriptor);
        descriptor = undefined;
        return { acquired: false, lockFd: null, lockPath, holderPid };
      }
      delay(Math.min(retryMs, remaining));
    }

    const payload: LockPayload = {
      pid: process.pid,
      holder: agentId,
      created_at: new Date().toISOString(),
    };
    const serialized = JSON.stringify(payload) + "\n";
    ftruncateSync(descriptor, 0);
    writeSync(descriptor, serialized, 0, "utf8");
    fsyncSync(descriptor);
    return { acquired: true, lockFd: descriptor, lockPath, holderPid: process.pid };
  } catch (error) {
    if (descriptor !== undefined) {
      if (acquired) {
        try {
          releaseFlock(descriptor);
        } catch {}
      }
      try {
        closeSync(descriptor);
      } catch {}
    }
    throw error;
  }
}

export function releaseMailboxLock(result: LockAcquisitionResult): void {
  if (!result.acquired || result.lockFd === null || result.lockFd < 0) return;
  const fd = result.lockFd;
  let releaseError: unknown;
  try {
    releaseFlock(fd);
  } catch (error) {
    releaseError = error;
  } finally {
    try {
      closeSync(fd);
    } catch (closeError) {
      releaseError ??= closeError;
    }
  }
  if (releaseError !== undefined) throw releaseError;
}

export function withExclusiveLock<T>(
  lockPath: string,
  agentId: string,
  operation: () => T,
  options?: SafeLockOptions,
): T {
  const result = acquireMailboxLock(lockPath, agentId, options);
  if (!result.acquired) {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
    throw new HarnessError(
      "LOCK_TIMEOUT",
      `timed out after ${timeoutMs}ms waiting for mailbox lock: ${lockPath}`,
    );
  }
  try {
    return operation();
  } finally {
    releaseMailboxLock(result);
  }
}

export async function withExclusiveLockAsync<T>(
  lockPath: string,
  agentId: string,
  operation: () => Promise<T>,
  options?: SafeLockOptions,
): Promise<T> {
  const result = acquireMailboxLock(lockPath, agentId, options);
  if (!result.acquired) {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
    throw new HarnessError(
      "LOCK_TIMEOUT",
      `timed out after ${timeoutMs}ms waiting for mailbox lock: ${lockPath}`,
    );
  }
  try {
    return await operation();
  } finally {
    releaseMailboxLock(result);
  }
}

export function reclaimStaleLocks(
  locksDir: string,
  staleThresholdMs: number = DEFAULT_STALE_THRESHOLD_MS,
): readonly string[] {
  if (!locksDir || typeof locksDir !== "string") {
    throw new HarnessError("INVALID_ARGUMENT", "locksDir must be a non-empty string");
  }
  if (!Number.isFinite(staleThresholdMs) || staleThresholdMs < 0) {
    throw new HarnessError("INVALID_ARGUMENT", "staleThresholdMs must be finite and non-negative");
  }
  if (!existsSync(locksDir)) return [];
  let dirStat: Stats;
  try {
    dirStat = statSync(locksDir);
  } catch {
    return [];
  }
  if (!dirStat.isDirectory()) return [];

  let entries: string[] = [];
  try {
    entries = readdirSync(locksDir);
  } catch {
    return [];
  }

  const reclaimed: string[] = [];
  const now = Date.now();
  for (const entry of entries) {
    if (!entry.endsWith(".lock")) continue;
    const fullPath = join(locksDir, entry);
    try {
      const fileStat = statSync(fullPath);
      if (!fileStat.isFile()) continue;

      let payload: LockPayload | null = null;
      try {
        payload = parseLockPayload(readFileSync(fullPath, "utf8"));
      } catch {
        payload = null;
      }

      const createdTime = payload !== null ? Date.parse(payload.created_at) : Number.NaN;
      const lockAgeMs = Number.isNaN(createdTime) ? now - fileStat.mtimeMs : now - createdTime;

      if (lockAgeMs <= staleThresholdMs) continue;
      if (payload !== null && isProcessAlive(payload.pid)) continue;

      let fd: number | undefined;
      try {
        fd = openSync(fullPath, constants.O_RDWR);
        if (tryExclusiveFlock(fd)) {
          try {
            unlinkSync(fullPath);
            reclaimed.push(fullPath);
          } finally {
            releaseFlock(fd);
          }
        }
      } catch {
        // Skip concurrently removed or unopenable lock file
      } finally {
        if (fd !== undefined) {
          try {
            closeSync(fd);
          } catch {}
        }
      }
    } catch {}
  }
  return reclaimed;
}
