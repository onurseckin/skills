import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { ChatError } from "./errors.ts";
import { isLockPayload, type LockPayload } from "./guards.ts";

export interface WriteAtomicOptions {
  readonly mode?: number;
}

export interface AppendAtomicResult {
  readonly offset: number;
  readonly bytesWritten: number;
}

export interface LockOptions {
  readonly timeoutMs?: number;
  readonly retryMs?: number;
  readonly staleAfterMs?: number;
  readonly holder?: string;
}

export function writeAtomic(
  filePath: string,
  content: string | Uint8Array,
  options: WriteAtomicOptions = {},
): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tempPath = join(dir, `.${basename(filePath)}.${randomUUID()}.tmp`);
  const mode = options.mode ?? 0o644;
  const fd = openSync(tempPath, "w", mode);
  try {
    const buffer = typeof content === "string" ? Buffer.from(content, "utf8") : content;
    writeSync(fd, buffer);
    try {
      fsyncSync(fd);
    } catch {}
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tempPath, filePath);
  } catch (error) {
    try {
      unlinkSync(tempPath);
    } catch {}
    throw error;
  }
}

export function appendAtomic(
  filePath: string,
  content: string | Uint8Array,
  options: WriteAtomicOptions = {},
): AppendAtomicResult {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const mode = options.mode ?? 0o644;
  const fd = openSync(filePath, "a+", mode);
  try {
    const stats = fstatSync(fd);
    const offset = stats.size;
    const buffer = typeof content === "string" ? Buffer.from(content, "utf8") : content;
    const bytesWritten = writeSync(fd, buffer);
    try {
      fsyncSync(fd);
    } catch {}
    return { offset, bytesWritten };
  } finally {
    closeSync(fd);
  }
}

export function delay(ms: number): void {
  if (ms > 0) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  }
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error) {
      const code = (error as { readonly code?: string }).code;
      if (code === "EPERM") {
        return true;
      }
      if (code === "ESRCH") {
        return false;
      }
    }
    return false;
  }
}

function parseLockContent(content: string): LockPayload | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (isLockPayload(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function acquireLock(lockPath: string, options: LockOptions = {}): void {
  const timeoutMs = options.timeoutMs ?? 5000;
  const retryMs = options.retryMs ?? 25;
  const staleAfterMs = options.staleAfterMs ?? 30000;
  const holder = options.holder ?? `pid:${process.pid}`;

  const dir = dirname(lockPath);
  mkdirSync(dir, { recursive: true });

  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    let fd: number | null = null;
    try {
      fd = openSync(lockPath, "wx", 0o600);
      const payload: LockPayload = {
        pid: process.pid,
        holder,
        created_at: new Date().toISOString(),
      };
      const buffer = Buffer.from(JSON.stringify(payload), "utf8");
      writeSync(fd, buffer);
      try {
        fsyncSync(fd);
      } catch {}
      return;
    } catch (error: unknown) {
      if (fd !== null) {
        try {
          unlinkSync(lockPath);
        } catch {}
        throw error;
      }

      const code =
        typeof error === "object" && error !== null && "code" in error
          ? (error as { readonly code?: string }).code
          : undefined;

      if (code !== "EEXIST") {
        throw error;
      }

      let shouldReclaim = false;
      let rawToReclaim: string | null = null;
      try {
        const stats = statSync(lockPath);
        const ageMs = Date.now() - stats.mtimeMs;
        const raw = readFileSync(lockPath, "utf8");
        const payload = parseLockContent(raw);

        if (payload !== null) {
          if (!isProcessAlive(payload.pid)) {
            shouldReclaim = true;
            rawToReclaim = raw;
          }
        } else if (ageMs > staleAfterMs) {
          shouldReclaim = true;
          rawToReclaim = raw;
        }
      } catch {}

      if (shouldReclaim && rawToReclaim !== null) {
        try {
          const currentRaw = readFileSync(lockPath, "utf8");
          if (currentRaw === rawToReclaim) {
            unlinkSync(lockPath);
            continue;
          }
        } catch {}
      }

      if (Date.now() + retryMs > deadline) {
        break;
      }
      delay(retryMs);
    } finally {
      if (fd !== null) {
        try {
          closeSync(fd);
        } catch {}
      }
    }
  }

  throw new ChatError(
    "LOCK_TIMEOUT",
    `Timed out acquiring lock '${lockPath}' after ${timeoutMs}ms`,
  );
}

export function releaseLock(
  lockPath: string,
  expected?: { readonly pid?: number; readonly holder?: string } | string,
): void {
  try {
    if (!existsSync(lockPath)) {
      return;
    }
    const raw = readFileSync(lockPath, "utf8");
    const payload = parseLockContent(raw);
    if (payload === null) {
      return;
    }
    const expectedPid =
      typeof expected === "object" && expected !== null && expected.pid !== undefined
        ? expected.pid
        : typeof expected === "number"
          ? expected
          : process.pid;
    if (payload.pid !== expectedPid) {
      return;
    }
    const expectedHolder =
      typeof expected === "string"
        ? expected
        : typeof expected === "object" && expected !== null && expected.holder !== undefined
          ? expected.holder
          : undefined;
    if (expectedHolder !== undefined && payload.holder !== expectedHolder) {
      return;
    }
    unlinkSync(lockPath);
  } catch {}
}

export function withLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  options?: LockOptions,
): Promise<T>;
export function withLock<T>(lockPath: string, fn: () => T, options?: LockOptions): T;
export function withLock<T>(
  lockPath: string,
  fn: () => T | Promise<T>,
  options: LockOptions = {},
): T | Promise<T> {
  const holder = options.holder ?? `pid:${process.pid}`;
  acquireLock(lockPath, { ...options, holder });
  let isPromise = false;
  try {
    const result = fn();
    if (
      typeof result === "object" &&
      result !== null &&
      "then" in result &&
      typeof (result as { then: unknown }).then === "function"
    ) {
      isPromise = true;
      return (result as Promise<T>).finally(() => {
        releaseLock(lockPath, { pid: process.pid, holder });
      });
    }
    return result;
  } finally {
    if (!isPromise) {
      releaseLock(lockPath, { pid: process.pid, holder });
    }
  }
}
