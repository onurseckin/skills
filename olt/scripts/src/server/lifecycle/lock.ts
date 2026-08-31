/**
 * Atomic Dev Server Restart Lock Subsystem.
 *
 * Provides cross-process file-based and intra-process memory-based atomic locking
 * to prevent race conditions during concurrent server restart triggers.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, openSync, closeSync, constants } from "node:fs";
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

/**
 * Checks if a lock file is stale.
 */
function isLockStale(lockPath: string, staleLockAgeMs: number): boolean {
  if (!existsSync(lockPath)) {
    return false;
  }
  try {
    const raw = readFileSync(lockPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      if ("pid" in parsed && "acquiredAt" in parsed) {
        const payload = parsed as { pid?: number; acquiredAt?: string };
        const holderPid = payload.pid;
        const acquiredAt = payload.acquiredAt;

        if (typeof holderPid === "number") {
          if (holderPid !== process.pid) {
            const alive = isPidAlive(holderPid);
            if (!alive) {
              return true;
            }
          }
        }

        if (typeof acquiredAt === "string") {
          const parsedTime = Date.parse(acquiredAt);
          if (!Number.isNaN(parsedTime)) {
            const age = Date.now() - parsedTime;
            if (age > staleLockAgeMs) {
              return true;
            }
          }
        }
      }
    }
  } catch {
    return true;
  }
  return false;
}

/**
 * Attempts a single atomic file lock creation using O_CREAT | O_EXCL.
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

  if (existsSync(lockPath)) {
    const stale = isLockStale(lockPath, staleLockAgeMs);
    if (stale) {
      try {
        unlinkSync(lockPath);
      } catch {
        // Ignore race in unlink
      }
    }
  }

  try {
    const fd = openSync(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR, 0o600);
    try {
      const content = JSON.stringify(payload, null, 2);
      writeFileSync(lockPath, content, "utf-8");
    } finally {
      closeSync(fd);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Sleep helper function.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/**
 * Checks whether the given lock path is currently locked.
 */
export async function isLocked(lockPath?: string): Promise<boolean> {
  let path = DEFAULT_LOCK_PATH;
  if (lockPath !== undefined && lockPath !== null && lockPath.length > 0) {
    path = lockPath;
  }
  const resolved = resolve(path);
  if (inProcessLocks.has(resolved)) {
    return true;
  }
  if (!existsSync(resolved)) {
    return false;
  }
  const stale = isLockStale(resolved, DEFAULT_STALE_LOCK_AGE_MS);
  return !stale;
}

/**
 * Forcefully releases a lock by removing file and in-memory flag.
 */
export async function forceReleaseLock(lockPath?: string): Promise<boolean> {
  let path = DEFAULT_LOCK_PATH;
  if (lockPath !== undefined && lockPath !== null && lockPath.length > 0) {
    path = lockPath;
  }
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
  let rawPath = DEFAULT_LOCK_PATH;
  if (options !== undefined && options !== null && options.lockPath !== undefined && options.lockPath.length > 0) {
    rawPath = options.lockPath;
  }
  const lockPath = resolve(rawPath);

  let timeoutMs = DEFAULT_LOCK_TIMEOUT_MS;
  if (options !== undefined && options !== null && typeof options.timeoutMs === "number") {
    timeoutMs = options.timeoutMs;
  }

  let pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
  if (options !== undefined && options !== null && typeof options.pollIntervalMs === "number") {
    pollIntervalMs = options.pollIntervalMs;
  }

  let staleLockAgeMs = DEFAULT_STALE_LOCK_AGE_MS;
  if (options !== undefined && options !== null && typeof options.staleLockAgeMs === "number") {
    staleLockAgeMs = options.staleLockAgeMs;
  }

  let lockHolderId = `process_${process.pid}_${Math.random().toString(36).slice(2, 10)}`;
  if (options !== undefined && options !== null && options.lockHolderId !== undefined && options.lockHolderId.length > 0) {
    lockHolderId = options.lockHolderId;
  }

  const startTime = Date.now();
  let acquired = false;
  const acquiredAt = new Date().toISOString();

  while (!acquired) {
    if (!inProcessLocks.has(lockPath)) {
      const payload: LockFilePayload = {
        lockHolderId,
        pid: process.pid,
        acquiredAt,
      };

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
    const waitTime = Math.min(pollIntervalMs, Math.max(5, remaining));
    await delay(waitTime);
  }

  let released = false;
  const handle: LockHandle = {
    lockPath,
    lockHolderId,
    acquiredAt,
    release: async (): Promise<void> => {
      if (released) {
        return;
      }
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

  return handle;
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
