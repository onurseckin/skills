import * as fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { releaseFlock, tryExclusiveFlock } from "../../platform/index.ts";
import { DEFAULT_STALE_THRESHOLD_MS } from "../types.ts";
import {
  getInMemoryLockEntries,
  isInMemoryLocking,
  isProcessAlive,
  parseLockPayload,
  removeInMemoryLock,
} from "./safe-lock.ts";

function verifyLockedInode(descriptor: number, lockPath: string): boolean {
  try {
    const fStat = fs.statSync(lockPath);
    const dStat = fs.fstatSync(descriptor);
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
    if (lockAgeMs <= staleThresholdMs || (payload !== null && isProcessAlive(payload.pid))) {
      return false;
    }
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
  if (!locksDir || typeof locksDir !== "string") {
    throw new HarnessError("INVALID_ARGUMENT", "locksDir must be a non-empty string");
  }
  if (!Number.isFinite(staleThresholdMs) || staleThresholdMs < 0) {
    throw new HarnessError("INVALID_ARGUMENT", "staleThresholdMs must be finite and non-negative");
  }
  const reclaimed: string[] = [];
  const entries = getInMemoryLockEntries();
  const now = Date.now();
  for (const [lockPath, entry] of entries) {
    if (!lockPath.endsWith(".lock")) continue;
    if (!isPathInDir(lockPath, locksDir)) continue;
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
  if (!locksDir || typeof locksDir !== "string") {
    throw new HarnessError("INVALID_ARGUMENT", "locksDir must be a non-empty string");
  }
  if (!Number.isFinite(staleThresholdMs) || staleThresholdMs < 0) {
    throw new HarnessError("INVALID_ARGUMENT", "staleThresholdMs must be finite and non-negative");
  }
  const memReclaimed = reclaimInMemoryStaleLocks(locksDir, staleThresholdMs);
  if (isInMemoryLocking()) return memReclaimed;

  try {
    if (!fs.existsSync(locksDir) || !fs.statSync(locksDir).isDirectory()) return memReclaimed;
    const entries = fs.readdirSync(locksDir);
    const now = Date.now();
    const reclaimed: string[] = [...memReclaimed];
    for (const e of entries) {
      if (!e.endsWith(".lock")) continue;
      const fullPath = join(locksDir, e);
      if (tryReclaimFile(fullPath, staleThresholdMs, now)) reclaimed.push(fullPath);
    }
    return reclaimed;
  } catch {
    return memReclaimed;
  }
}
