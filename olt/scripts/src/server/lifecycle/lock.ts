/**
 * Atomic Dev Server Restart Lock Subsystem.
 *
 * Provides cross-process file-based and intra-process memory-based atomic locking
 * to prevent race conditions during concurrent server restart triggers.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  openSync,
  closeSync,
  writeSync,
  fsyncSync,
  statSync,
  constants,
} from "node:fs";
import { dirname, resolve } from "node:path";
import type { LockHandle, LockOptions } from "./types.ts";

export const DEFAULT_LOCK_PATH = ".locks/server-restart.lock";
export const DEFAULT_LOCK_TIMEOUT_MS = 5000;
export const DEFAULT_POLL_INTERVAL_MS = 50;
export const DEFAULT_STALE_LOCK_AGE_MS = 30000;

interface LockFilePayload {
  readonly lockHolderId: string;
  readonly pid: number;
  readonly acquiredAt: string;
}

// In-process lock tracker for coordinating multiple async calls in same process
const inProcessLocks = new Set<string>();

/**
 * Custom Error for Lock Timeout and Contention.
 */
export class ServerLockError extends Error {
  public readonly code: string;
  public readonly lockPath: string;

  public constructor(message: string, lockPath: string, code: string = "LOCK_TIMEOUT") {
    super(message);
    this.name = "ServerLockError";
    this.code = code;
    this.lockPath = lockPath;
  }
}

/**
 * Checks if a process with given PID is alive.
 */
function isPidAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks if a lock file is stale with race-resilient timestamp and PID validation.
 */
function isLockStale(lockPath: string, staleLockAgeMs: number): boolean {
  if (!existsSync(lockPath)) return false;
  try {
    const stat = statSync(lockPath);
    const fileAge = Date.now() - stat.mtimeMs;

    const raw = readFileSync(lockPath, "utf-8");
    if (raw.trim().length === 0) {
      // Allow a 2-second grace period for newly created lock files mid-write
      return fileAge > Math.min(staleLockAgeMs, 2000);
    }

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      const payload = parsed as Partial<LockFilePayload>;
      const holderPid = payload.pid;
      const acquiredAt = payload.acquiredAt;

      if (typeof holderPid === "number" && holderPid !== process.pid) {
        if (!isPidAlive(holderPid)) return true;
      }

      if (typeof acquiredAt === "string") {
        const parsedTime = Date.parse(acquiredAt);
        if (!Number.isNaN(parsedTime)) {
          if (Date.now() - parsedTime > staleLockAgeMs) return true;
        }
      }
    }
  } catch {
    try {
      const stat = statSync(lockPath);
      return Date.now() - stat.mtimeMs > staleLockAgeMs;
    } catch {
      return true;
    }
  }
  return false;
}

/**
 * Attempts single atomic file lock creation writing directly to acquired file descriptor.
 */
function tryCreateLockFile(
  lockPath: string,
  payload: LockFilePayload,
  staleLockAgeMs: number,
): boolean {
  const dir = dirname(lockPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  if (existsSync(lockPath) && isLockStale(lockPath, staleLockAgeMs)) {
    try {
      unlinkSync(lockPath);
    } catch {
      // Ignore race in unlink
    }
  }

  try {
    const fd = openSync(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR, 0o600);
    try {
      const content = JSON.stringify(payload, null, 2);
      writeSync(fd, content, 0, "utf-8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    return true;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/**
 * Checks whether the given lock path is currently locked.
 */
export async function isLocked(lockPath?: string): Promise<boolean> {
  const path = lockPath && lockPath.length > 0 ? lockPath : DEFAULT_LOCK_PATH;
  const resolved = resolve(path);
  if (inProcessLocks.has(resolved)) return true;
  if (!existsSync(resolved)) return false;
  return !isLockStale(resolved, DEFAULT_STALE_LOCK_AGE_MS);
}

/**
 * Forcefully releases a lock by removing file and in-memory flag.
 */
export async function forceReleaseLock(lockPath?: string): Promise<boolean> {
  const path = lockPath && lockPath.length > 0 ? lockPath : DEFAULT_LOCK_PATH;
  const resolved = resolve(path);
  inProcessLocks.delete(resolved);
  if (existsSync(resolved)) {
    try {
      unlinkSync(resolved);
      return true;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Acquires the atomic restart lock.
 */
export async function acquireLock(options?: LockOptions): Promise<LockHandle> {
  const lockPath = resolve(options?.lockPath ?? DEFAULT_LOCK_PATH);
  const timeoutMs = options?.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const staleLockAgeMs = options?.staleLockAgeMs ?? DEFAULT_STALE_LOCK_AGE_MS;
  const lockHolderId =
    options?.lockHolderId ?? `process_${process.pid}_${Math.random().toString(36).slice(2, 10)}`;

  const startTime = Date.now();
  let acquired = false;
  const acquiredAt = new Date().toISOString();

  while (!acquired) {
    if (!inProcessLocks.has(lockPath)) {
      const payload: LockFilePayload = { lockHolderId, pid: process.pid, acquiredAt };
      if (tryCreateLockFile(lockPath, payload, staleLockAgeMs)) {
        inProcessLocks.add(lockPath);
        acquired = true;
        break;
      }
    }

    const elapsed = Date.now() - startTime;
    if (elapsed >= timeoutMs) {
      throw new ServerLockError(
        `Failed to acquire atomic dev server restart lock within ${timeoutMs}ms: ${lockPath}`,
        lockPath,
        "LOCK_TIMEOUT",
      );
    }

    const remaining = timeoutMs - elapsed;
    await delay(Math.min(pollIntervalMs, Math.max(5, remaining)));
  }

  let released = false;
  return {
    lockPath,
    lockHolderId,
    acquiredAt,
    release: async (): Promise<void> => {
      if (released) return;
      released = true;
      inProcessLocks.delete(lockPath);
      if (existsSync(lockPath)) {
        try {
          unlinkSync(lockPath);
        } catch {
          // Ignore if already unlinked
        }
      }
    },
  };
}

/**
 * Releases a lock handle or path.
 */
export async function releaseLock(target: LockHandle | string): Promise<void> {
  if (typeof target === "string") {
    await forceReleaseLock(target);
  } else {
    await target.release();
  }
}

/**
 * Executes an async action wrapped inside an atomic restart lock.
 */
export async function withRestartLock<T>(
  action: () => Promise<T>,
  options?: LockOptions,
): Promise<T> {
  const lock = await acquireLock(options);
  try {
    return await action();
  } finally {
    await lock.release();
  }
}
