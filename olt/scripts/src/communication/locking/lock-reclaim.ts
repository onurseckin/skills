import * as fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { releaseFlock, tryExclusiveFlock } from "../../platform/index.ts";
import type { LockPayload } from "../types.ts";
import { DEFAULT_STALE_THRESHOLD_MS } from "../types.ts";
import { isProcessAlive, parseLockPayload } from "./safe-lock.ts";

export interface InMemoryLockRecord {
  readonly pid: number;
  readonly holder: string;
  readonly created_at: string;
  readonly mtimeMs: number;
  readonly fd: number;
}

const IN_MEMORY_LOCKS = new Map<string, InMemoryLockRecord>();
let inMemoryLockingEnabled = false;
let syntheticFdCounter = 100_000;

export const setInMemoryLocking = (e: boolean): void => {
  inMemoryLockingEnabled = e;
};
export const isInMemoryLocking = (): boolean => inMemoryLockingEnabled;
export const resetInMemoryLocks = (): void => {
  IN_MEMORY_LOCKS.clear();
  syntheticFdCounter = 100_000;
};
export const getInMemoryLock = (p: string): InMemoryLockRecord | null =>
  IN_MEMORY_LOCKS.get(p) ?? null;
export const removeInMemoryLock = (p: string): boolean => IN_MEMORY_LOCKS.delete(p);
export const getInMemoryLockEntries = (): ReadonlyMap<string, InMemoryLockRecord> =>
  IN_MEMORY_LOCKS;

export function seedInMemoryLock(p: string, pl: LockPayload, mtimeMs = Date.now()): number {
  const fd = ++syntheticFdCounter;
  IN_MEMORY_LOCKS.set(p, { ...pl, mtimeMs, fd });
  return fd;
}

export function tryAcquireInMemoryLock(p: string, holder: string) {
  const ex = IN_MEMORY_LOCKS.get(p);
  if (ex) return { fd: null, acquired: false, holderPid: ex.pid };
  const fd = ++syntheticFdCounter,
    mtimeMs = Date.now();
  IN_MEMORY_LOCKS.set(p, {
    pid: process.pid,
    holder,
    created_at: new Date(mtimeMs).toISOString(),
    mtimeMs,
    fd,
  });
  return { fd, acquired: true, holderPid: process.pid };
}

export function releaseInMemoryLock(p: string, fd: number): boolean {
  return IN_MEMORY_LOCKS.get(p)?.fd === fd ? IN_MEMORY_LOCKS.delete(p) : false;
}

function verifyLockedInode(descriptor: number, lockPath: string): boolean {
  try {
    const fStat = fs.statSync(lockPath),
      dStat = fs.fstatSync(descriptor);
    return fStat.ino === dStat.ino && fStat.dev === dStat.dev;
  } catch {
    return false;
  }
}

function tryReclaimFile(fullPath: string, staleThresholdMs: number, now: number): boolean {
  try {
    const fileStat = fs.statSync(fullPath);
    if (!fileStat.isFile()) return false;
    const payload = parseLockPayload(fs.readFileSync(fullPath, "utf8"));
    const createdTime = payload !== null ? Date.parse(payload.created_at) : Number.NaN;
    const lockAgeMs = Number.isNaN(createdTime) ? now - fileStat.mtimeMs : now - createdTime;
    if (lockAgeMs <= staleThresholdMs || (payload !== null && isProcessAlive(payload.pid)))
      return false;
    let fd: number | undefined;
    try {
      fd = fs.openSync(fullPath, fs.constants.O_RDWR);
      if (tryExclusiveFlock(fd)) {
        if (verifyLockedInode(fd, fullPath)) {
          try {
            fs.unlinkSync(fullPath);
            return true;
          } finally {
            releaseFlock(fd);
          }
        }
        releaseFlock(fd);
      }
    } catch {
    } finally {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch {}
      }
    }
    return false;
  } catch {
    return false;
  }
}

function isPathInDir(filePath: string, dirPath: string): boolean {
  try {
    return resolve(dirname(filePath)) === resolve(dirPath);
  } catch {
    return false;
  }
}

export function reclaimInMemoryStaleLocks(
  locksDir: string,
  staleThresholdMs: number = DEFAULT_STALE_THRESHOLD_MS,
): readonly string[] {
  if (!locksDir || typeof locksDir !== "string")
    throw new HarnessError("INVALID_ARGUMENT", "locksDir must be a non-empty string");
  if (!Number.isFinite(staleThresholdMs) || staleThresholdMs < 0)
    throw new HarnessError("INVALID_ARGUMENT", "staleThresholdMs must be finite and non-negative");
  const reclaimed: string[] = [],
    entries = getInMemoryLockEntries(),
    now = Date.now();
  for (const [lockPath, entry] of entries) {
    if (!lockPath.endsWith(".lock") || !isPathInDir(lockPath, locksDir)) continue;
    const createdTime = Date.parse(entry.created_at);
    const lockAgeMs = Number.isNaN(createdTime) ? now - entry.mtimeMs : now - createdTime;
    if (lockAgeMs > staleThresholdMs && !isProcessAlive(entry.pid)) {
      removeInMemoryLock(lockPath);
      reclaimed.push(lockPath);
    }
  }
  return reclaimed;
}

export function reclaimStaleLocks(
  locksDir: string,
  staleThresholdMs: number = DEFAULT_STALE_THRESHOLD_MS,
): readonly string[] {
  if (!locksDir || typeof locksDir !== "string")
    throw new HarnessError("INVALID_ARGUMENT", "locksDir must be a non-empty string");
  if (!Number.isFinite(staleThresholdMs) || staleThresholdMs < 0)
    throw new HarnessError("INVALID_ARGUMENT", "staleThresholdMs must be finite and non-negative");
  if (isInMemoryLocking()) return reclaimInMemoryStaleLocks(locksDir, staleThresholdMs);
  if (!fs.existsSync(locksDir) || !fs.statSync(locksDir).isDirectory()) return [];
  const entries = fs.readdirSync(locksDir),
    reclaimed: string[] = [],
    now = Date.now();
  for (const entry of entries) {
    if (!entry.endsWith(".lock")) continue;
    const fullPath = join(locksDir, entry);
    if (tryReclaimFile(fullPath, staleThresholdMs, now)) reclaimed.push(fullPath);
  }
  return reclaimed;
}
