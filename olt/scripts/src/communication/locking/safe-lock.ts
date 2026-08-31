import * as fs from "node:fs";
import { dirname } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { releaseFlock, tryExclusiveFlock } from "../../platform/index.ts";
import type { LockAcquisitionResult, LockPayload, SafeLockOptions } from "../types.ts";
import {
  getInMemoryLock,
  getInMemoryLockEntries,
  isInMemoryLocking,
  releaseInMemoryLock,
  removeInMemoryLock,
  resetInMemoryLocks,
  seedInMemoryLock,
  setInMemoryLocking,
  tryAcquireInMemoryLock,
  type InMemoryLockRecord,
} from "./lock-reclaim.ts";

export * from "../types.ts";
export {
  getInMemoryLock,
  getInMemoryLockEntries,
  isInMemoryLocking,
  releaseInMemoryLock,
  removeInMemoryLock,
  resetInMemoryLocks,
  seedInMemoryLock,
  setInMemoryLocking,
  tryAcquireInMemoryLock,
  type InMemoryLockRecord,
};

export function delay(ms: number): void {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    return process.kill(pid, 0) || true;
  } catch (e: unknown) {
    return (e as { code?: string })?.code === "EPERM";
  }
}

export function parseLockPayload(content: string): LockPayload | null {
  const t = content.trim();
  if (!t.startsWith("{") || !t.endsWith("}")) return null;
  try {
    const p = JSON.parse(t);
    return typeof p?.holder === "string" &&
      typeof p?.created_at === "string" &&
      Number.isInteger(p?.pid)
      ? { pid: p.pid, holder: p.holder, created_at: p.created_at }
      : null;
  } catch {
    return null;
  }
}

export function readHolderPid(lockPath: string): number | null {
  const mem = getInMemoryLock(lockPath);
  if (mem) return mem.pid;
  try {
    return parseLockPayload(fs.readFileSync(lockPath, "utf8"))?.pid ?? null;
  } catch {
    return null;
  }
}

function valArg(p: string, id: string, opts?: SafeLockOptions) {
  if (!p || typeof p !== "string")
    throw new HarnessError("INVALID_ARGUMENT", "lockPath must be a non-empty string");
  if (!id || typeof id !== "string")
    throw new HarnessError("INVALID_ARGUMENT", "agentId must be a non-empty string");
  const c = (v: number, n: string) => {
    if (!Number.isFinite(v) || v < 0)
      throw new HarnessError("INVALID_ARGUMENT", `${n} must be finite and non-negative`);
    return v;
  };
  return {
    timeoutMs: c(opts?.timeoutMs ?? 5000, "timeoutMs"),
    staleThresholdMs: c(opts?.staleThresholdMs ?? 30000, "staleThresholdMs"),
    retryMs: c(opts?.retryMs ?? 25, "retryMs"),
  };
}

function ensureLockDir(lockPath: string): void {
  const dir = dirname(lockPath);
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    } catch (e) {
      throw new HarnessError("INTEGRITY", `failed to create lock directory '${dir}': ${String(e)}`);
    }
  }
}

const closeFlock = (fd: number) => {
  try {
    releaseFlock(fd);
  } catch {}
  try {
    fs.closeSync(fd);
  } catch {}
};

function tryAcquireStep(p: string, id: string, desc: number | null, inMem: boolean) {
  if (inMem) return tryAcquireInMemoryLock(p, id);
  let fd = desc;
  if (fd === null) {
    try {
      fd = fs.openSync(p, fs.constants.O_RDWR | fs.constants.O_CREAT, 0o644);
    } catch (e) {
      throw new HarnessError("INTEGRITY", `failed to open lock file '${p}': ${String(e)}`);
    }
  }
  if (tryExclusiveFlock(fd)) {
    try {
      if (fs.statSync(p).ino === fs.fstatSync(fd).ino) {
        fs.ftruncateSync(fd, 0);
        fs.writeSync(
          fd,
          JSON.stringify({ pid: process.pid, holder: id, created_at: new Date().toISOString() }) +
            "\n",
          0,
          "utf8",
        );
        fs.fsyncSync(fd);
        return { fd, acquired: true, holderPid: process.pid };
      }
    } catch (err) {
      closeFlock(fd);
      throw err;
    }
    closeFlock(fd);
    fd = null;
  }
  return { fd, acquired: false, holderPid: null };
}

function executeAcquire(
  p: string,
  id: string,
  opts: SafeLockOptions | undefined,
  waitFn: (ms: number) => void | Promise<void>,
) {
  const { timeoutMs, retryMs } = valArg(p, id, opts);
  if (!isInMemoryLocking()) ensureLockDir(p);
  const deadline = performance.now() + timeoutMs;
  let desc: number | null = null;
  const cleanup = () => {
    if (desc !== null && desc >= 0) {
      if (desc >= 100_000) releaseInMemoryLock(p, desc);
      else closeFlock(desc);
      desc = null;
    }
  };
  const loop = (): LockAcquisitionResult | Promise<LockAcquisitionResult> => {
    try {
      while (true) {
        const step = tryAcquireStep(p, id, desc, isInMemoryLocking());
        desc = step.fd;
        if (step.acquired && desc !== null)
          return { acquired: true, lockFd: desc, lockPath: p, holderPid: process.pid };
        const rem = deadline - performance.now();
        if (rem <= 0) {
          cleanup();
          return {
            acquired: false,
            lockFd: null,
            lockPath: p,
            holderPid: isInMemoryLocking() ? step.holderPid : readHolderPid(p),
          };
        }
        const w = waitFn(Math.min(retryMs, rem));
        if (w instanceof Promise) {
          return w
            .then(() => loop())
            .catch((err) => {
              cleanup();
              throw err;
            });
        }
      }
    } catch (err) {
      cleanup();
      throw err;
    }
  };
  return loop();
}

export function acquireMailboxLock(
  p: string,
  id: string,
  o?: SafeLockOptions,
): LockAcquisitionResult {
  return executeAcquire(p, id, o, delay) as LockAcquisitionResult;
}

export function acquireMailboxLockAsync(
  p: string,
  id: string,
  o?: SafeLockOptions,
): Promise<LockAcquisitionResult> {
  return executeAcquire(
    p,
    id,
    o,
    (ms) => new Promise((r) => setTimeout(r, ms)),
  ) as Promise<LockAcquisitionResult>;
}

export function releaseMailboxLock(res: LockAcquisitionResult): void {
  if (!res.acquired || res.lockFd === null || res.lockFd < 0) return;
  if (res.lockFd >= 100_000) {
    releaseInMemoryLock(res.lockPath, res.lockFd);
    return;
  }
  let err: unknown;
  try {
    releaseFlock(res.lockFd);
  } catch (e) {
    err = e;
  }
  try {
    fs.closeSync(res.lockFd);
  } catch (e) {
    err ??= e;
  }
  if (err !== undefined) throw err;
}

function handleTimeout(opts?: SafeLockOptions, p?: string): never {
  const t = opts?.timeoutMs ?? 5000;
  throw new HarnessError("LOCK_TIMEOUT", `timed out after ${t}ms waiting for mailbox lock: ${p}`);
}

export function withExclusiveLock<T>(
  p: string,
  id: string,
  fn: () => T,
  opts?: SafeLockOptions,
): T {
  const res = acquireMailboxLock(p, id, opts);
  if (!res.acquired) handleTimeout(opts, p);
  try {
    return fn();
  } finally {
    releaseMailboxLock(res);
  }
}

export async function withExclusiveLockAsync<T>(
  p: string,
  id: string,
  fn: () => Promise<T>,
  opts?: SafeLockOptions,
): Promise<T> {
  const res = await acquireMailboxLockAsync(p, id, opts);
  if (!res.acquired) handleTimeout(opts, p);
  try {
    return await fn();
  } finally {
    releaseMailboxLock(res);
  }
}
