import type { LockPayload } from "../types.ts";

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

export function setInMemoryLocking(enabled: boolean): void {
  inMemoryLockingEnabled = enabled;
}

export function isInMemoryLocking(): boolean {
  return inMemoryLockingEnabled;
}

export function resetInMemoryLocks(): void {
  IN_MEMORY_LOCKS.clear();
  syntheticFdCounter = 100_000;
}

export function getInMemoryLock(lockPath: string): InMemoryLockRecord | null {
  return IN_MEMORY_LOCKS.get(lockPath) ?? null;
}

export function removeInMemoryLock(lockPath: string): boolean {
  return IN_MEMORY_LOCKS.delete(lockPath);
}

export function getInMemoryLockEntries(): ReadonlyMap<string, InMemoryLockRecord> {
  return IN_MEMORY_LOCKS;
}

export function seedInMemoryLock(
  lockPath: string,
  payload: LockPayload,
  mtimeMs = Date.now(),
): number {
  const fd = ++syntheticFdCounter;
  IN_MEMORY_LOCKS.set(lockPath, {
    pid: payload.pid,
    holder: payload.holder,
    created_at: payload.created_at,
    mtimeMs,
    fd,
  });
  return fd;
}

export function tryAcquireInMemoryLock(
  lockPath: string,
  agentId: string,
): { fd: number | null; acquired: boolean; holderPid: number | null } {
  const existing = IN_MEMORY_LOCKS.get(lockPath);
  if (!existing) {
    const fd = ++syntheticFdCounter;
    const now = Date.now();
    IN_MEMORY_LOCKS.set(lockPath, {
      pid: process.pid,
      holder: agentId,
      created_at: new Date(now).toISOString(),
      mtimeMs: now,
      fd,
    });
    return { fd, acquired: true, holderPid: process.pid };
  }
  return { fd: null, acquired: false, holderPid: existing.pid };
}

export function releaseInMemoryLock(lockPath: string, fd: number): boolean {
  const existing = IN_MEMORY_LOCKS.get(lockPath);
  if (existing && existing.fd === fd) {
    IN_MEMORY_LOCKS.delete(lockPath);
    return true;
  }
  return false;
}
