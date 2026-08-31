import * as fs from "node:fs";
import { dirname } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { releaseFlock, tryExclusiveFlock } from "../../platform/index.ts";
import {
  DEFAULT_LOCK_TIMEOUT_MS,
  DEFAULT_RETRY_INTERVAL_MS,
  DEFAULT_STALE_THRESHOLD_MS,
  type LockAcquisitionResult,
  type LockOptions,
  type LockPayload,
  type SafeLockOptions,
} from "../types.ts";
import {
  isInMemoryLocking,
  releaseInMemoryLock,
  tryAcquireInMemoryLock,
} from "./in-memory-locks.ts";
import { delay, readHolderPid } from "./lock-payload.ts";

export {
  DEFAULT_LOCK_TIMEOUT_MS,
  DEFAULT_RETRY_INTERVAL_MS,
  DEFAULT_STALE_THRESHOLD_MS,
  type LockAcquisitionResult,
  type LockOptions,
  type LockPayload,
  type SafeLockOptions,
};
export {
  getInMemoryLock,
  getInMemoryLockEntries,
  isInMemoryLocking,
  removeInMemoryLock,
  resetInMemoryLocks,
  seedInMemoryLock,
  setInMemoryLocking,
  type InMemoryLockRecord,
} from "./in-memory-locks.ts";
export { delay, isProcessAlive, parseLockPayload, readHolderPid } from "./lock-payload.ts";
export { reclaimStaleLocks } from "./lock-reclaim.ts";

function validateLockArgs(
  lockPath: string,
  agentId: string,
  options?: SafeLockOptions,
): { timeoutMs: number; staleThresholdMs: number; retryMs: number } {
  if (!lockPath || typeof lockPath !== "string")
    throw new HarnessError("INVALID_ARGUMENT", "lockPath must be a non-empty string");
  if (!agentId || typeof agentId !== "string")
    throw new HarnessError("INVALID_ARGUMENT", "agentId must be a non-empty string");
  const check = (val: number, name: string): number => {
    if (!Number.isFinite(val) || val < 0)
      throw new HarnessError("INVALID_ARGUMENT", `${name} must be finite and non-negative`);
    return val;
  };
  return {
    timeoutMs: check(options?.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS, "timeoutMs"),
    staleThresholdMs: check(
      options?.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS,
      "staleThresholdMs",
    ),
    retryMs: check(options?.retryMs ?? DEFAULT_RETRY_INTERVAL_MS, "retryMs"),
  };
}

function ensureLockDir(lockPath: string): void {
  const lockDir = dirname(lockPath);
  if (!fs.existsSync(lockDir)) {
    try {
      fs.mkdirSync(lockDir, { recursive: true, mode: 0o700 });
    } catch (e) {
      throw new HarnessError(
        "INTEGRITY",
        `failed to create lock directory '${lockDir}': ${String(e)}`,
      );
    }
  }
}

function verifyLockedInode(descriptor: number, lockPath: string): boolean {
  try {
    const fStat = fs.statSync(lockPath);
    const dStat = fs.fstatSync(descriptor);
    return fStat.ino === dStat.ino && fStat.dev === dStat.dev;
  } catch {
    return false;
  }
}

function writeLockPayload(descriptor: number, agentId: string): void {
  const payload: LockPayload = {
    pid: process.pid,
    holder: agentId,
    created_at: new Date().toISOString(),
  };
  fs.ftruncateSync(descriptor, 0);
  fs.writeSync(descriptor, JSON.stringify(payload) + "\n", 0, "utf8");
  fs.fsyncSync(descriptor);
}

function tryAcquireStep(
  lockPath: string,
  agentId: string,
  descriptor: number | null,
  inMem: boolean,
): { fd: number | null; acquired: boolean; holderPid: number | null } {
  if (inMem) return tryAcquireInMemoryLock(lockPath, agentId);
  let fd = descriptor;
  if (fd === null) {
    try {
      fd = fs.openSync(lockPath, fs.constants.O_RDWR | fs.constants.O_CREAT, 0o644);
    } catch (error) {
      throw new HarnessError(
        "INTEGRITY",
        `failed to open lock file '${lockPath}': ${String(error)}`,
      );
    }
  }
  if (tryExclusiveFlock(fd)) {
    if (verifyLockedInode(fd, lockPath)) {
      try {
        writeLockPayload(fd, agentId);
        return { fd, acquired: true, holderPid: process.pid };
      } catch (error) {
        try {
          releaseFlock(fd);
        } catch {}
        try {
          fs.closeSync(fd);
        } catch {}
        throw error;
      }
    }
    releaseFlock(fd);
    fs.closeSync(fd);
    fd = null;
  }
  return { fd, acquired: false, holderPid: null };
}

function executeAcquire(
  lockPath: string,
  agentId: string,
  options: SafeLockOptions | undefined,
  waitFn: (ms: number) => void | Promise<void>,
): LockAcquisitionResult | Promise<LockAcquisitionResult> {
  const { timeoutMs, retryMs } = validateLockArgs(lockPath, agentId, options);
  const inMem = isInMemoryLocking();
  if (!inMem) ensureLockDir(lockPath);
  const deadline = performance.now() + timeoutMs;
  let descriptor: number | null = null;

  const loop = (): LockAcquisitionResult | Promise<LockAcquisitionResult> => {
    while (true) {
      const step = tryAcquireStep(lockPath, agentId, descriptor, inMem);
      descriptor = step.fd;
      if (step.acquired && descriptor !== null) {
        return { acquired: true, lockFd: descriptor, lockPath, holderPid: process.pid };
      }
      const remaining = deadline - performance.now();
      if (remaining <= 0) {
        const holderPid = inMem ? step.holderPid : readHolderPid(lockPath);
        if (descriptor !== null) fs.closeSync(descriptor);
        return { acquired: false, lockFd: null, lockPath, holderPid };
      }
      const waitRes = waitFn(Math.min(retryMs, remaining));
      if (waitRes instanceof Promise) return waitRes.then(() => loop());
    }
  };
  return loop();
}

export function acquireMailboxLock(
  lockPath: string,
  agentId: string,
  options?: SafeLockOptions,
): LockAcquisitionResult {
  return executeAcquire(lockPath, agentId, options, delay) as LockAcquisitionResult;
}

export async function acquireMailboxLockAsync(
  lockPath: string,
  agentId: string,
  options?: SafeLockOptions,
): Promise<LockAcquisitionResult> {
  return executeAcquire(lockPath, agentId, options, (ms) => new Promise((r) => setTimeout(r, ms)));
}

export function releaseMailboxLock(result: LockAcquisitionResult): void {
  if (!result.acquired || result.lockFd === null || result.lockFd < 0) return;
  const fd = result.lockFd;
  if (fd >= 100_000) {
    releaseInMemoryLock(result.lockPath, fd);
    return;
  }
  let err: unknown;
  try {
    releaseFlock(fd);
  } catch (error) {
    err = error;
  } finally {
    try {
      fs.closeSync(fd);
    } catch (closeError) {
      err ??= closeError;
    }
  }
  if (err !== undefined) throw err;
}

export function withExclusiveLock<T>(
  lockPath: string,
  agentId: string,
  operation: () => T,
  options?: SafeLockOptions,
): T {
  const result = acquireMailboxLock(lockPath, agentId, options);
  if (!result.acquired) {
    const t = options?.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
    throw new HarnessError(
      "LOCK_TIMEOUT",
      `timed out after ${t}ms waiting for mailbox lock: ${lockPath}`,
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
  const result = await acquireMailboxLockAsync(lockPath, agentId, options);
  if (!result.acquired) {
    const t = options?.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
    throw new HarnessError(
      "LOCK_TIMEOUT",
      `timed out after ${t}ms waiting for mailbox lock: ${lockPath}`,
    );
  }
  try {
    return await operation();
  } finally {
    releaseMailboxLock(result);
  }
}
