import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  realpathSync,
} from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { releaseFlock, tryExclusiveFlock } from "../fs/flock-ffi.ts";
import { clearObserver, publishObserver } from "./observer.ts";
export { clearObserver, publishObserver } from "./observer.ts";
import { resolveCapsulesDir } from "../../core/shared/paths.ts";

export interface RunLockOptions {
  timeoutMs?: number;
  retryMs?: number;
}

interface InodeIdentity {
  readonly dev: number;
  readonly ino: number;
}

function assertPathIdentity(runRoot: string, opened: InodeIdentity): void {
  let current;
  try {
    current = lstatSync(runRoot);
  } catch (error) {
    throw new HarnessError("PATH_SAFETY", `run root disappeared while locked: ${String(error)}`);
  }
  if (
    !current.isDirectory() ||
    current.isSymbolicLink() ||
    current.dev !== opened.dev ||
    current.ino !== opened.ino
  )
    throw new HarnessError("PATH_SAFETY", `run root identity changed while locked: ${runRoot}`);
}

function delay(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function timeout(value: number): number {
  if (!Number.isFinite(value) || value < 0)
    throw new HarnessError("INVALID_ARGUMENT", "timeoutMs must be finite and non-negative");
  return value;
}

export function withRunLock<T>(
  runRoot: string,
  operation: () => T,
  options: RunLockOptions = {},
): T {
  let targetPath = runRoot;
  if (!existsSync(targetPath)) {
    const candidate = join(resolveCapsulesDir(), runRoot);
    if (existsSync(candidate)) {
      targetPath = candidate;
    }
  }
  const metadata = lstatSync(targetPath);
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    throw new HarnessError("INVALID_ARGUMENT", `run root must be a real directory: ${runRoot}`);
  const descriptor = openSync(
    targetPath,
    constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
  );
  const opened = fstatSync(descriptor);
  if (!opened.isDirectory()) {
    closeSync(descriptor);
    throw new HarnessError("INVALID_ARGUMENT", `run root must be a directory: ${runRoot}`);
  }
  assertPathIdentity(targetPath, opened);
  const root = realpathSync(targetPath);
  const maximum = timeout(options.timeoutMs ?? 10_000);
  const retry = timeout(options.retryMs ?? 10);
  const deadline = performance.now() + maximum;
  let acquired = false;
  try {
    while (!(acquired = tryExclusiveFlock(descriptor))) {
      const remaining = deadline - performance.now();
      if (remaining <= 0) {
        throw new HarnessError(
          "LOCK_TIMEOUT",
          `timed out after ${maximum}ms waiting for run lock: ${root}`,
        );
      }
      delay(Math.min(retry, remaining));
    }
    assertPathIdentity(targetPath, opened);
    const observer = publishObserver(root);
    try {
      const result = operation();
      assertPathIdentity(targetPath, opened);
      return result;
    } catch (error) {
      assertPathIdentity(targetPath, opened);
      throw error;
    } finally {
      clearObserver(observer);
    }
  } finally {
    try {
      if (acquired) releaseFlock(descriptor);
    } finally {
      closeSync(descriptor);
    }
  }
}
