import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync } from "node:fs";
import { join, resolve } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { releaseFlock, tryExclusiveFlock } from "../../platform/index.ts";
import { DEFAULT_QUOTA_SNAPSHOT_FILENAME } from "./types.ts";

export function isOwnCode(error: unknown, code: string): boolean {
  return error instanceof Error && Object.getOwnPropertyDescriptor(error, "code")?.value === code;
}

export function canonicalPath(repoRoot: string): string {
  return join(resolve(repoRoot), ".olt", DEFAULT_QUOTA_SNAPSHOT_FILENAME);
}

export function regular(path: string, required: boolean): { dev: number; ino: number } | undefined {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.nlink !== 1)
      throw new HarnessError(
        "INTEGRITY",
        `quota snapshot must be a single-link regular file: ${path}`,
      );
    return { dev: stat.dev, ino: stat.ino };
  } catch (error) {
    if (!required && isOwnCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

export function acquire(path: string, label: string): number {
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const opened = fstatSync(fd);
  const visible = lstatSync(path);
  if (
    !opened.isDirectory() ||
    !visible.isDirectory() ||
    opened.dev !== visible.dev ||
    opened.ino !== visible.ino
  ) {
    closeSync(fd);
    throw new HarnessError("INTEGRITY", `${label} changed while opening`);
  }
  for (let attempt = 0; attempt < 200; attempt++) {
    if (tryExclusiveFlock(fd)) return fd;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
  }
  closeSync(fd);
  throw new HarnessError("LOCK_TIMEOUT", `${label} is locked`);
}

export function withSnapshotLock<T>(repoRoot: string, operation: (path: string) => T): T {
  const root = resolve(repoRoot);
  let rootFd: number | undefined;
  let parentFd: number | undefined;
  let primary: unknown;
  let didThrow = false;
  let result!: T;
  try {
    rootFd = acquire(root, "repository root");
    const identity = fstatSync(rootFd);
    const parent = join(root, ".olt");
    try {
      mkdirSync(parent, { mode: 0o700 });
    } catch (error) {
      if (!isOwnCode(error, "EEXIST")) throw error;
    }
    parentFd = acquire(parent, "quota snapshot parent");
    const current = lstatSync(root);
    if (current.dev !== identity.dev || current.ino !== identity.ino)
      throw new HarnessError("INTEGRITY", "repository root changed during quota snapshot mutation");
    result = operation(canonicalPath(root));
    const after = lstatSync(root);
    if (after.dev !== identity.dev || after.ino !== identity.ino)
      throw new HarnessError("INTEGRITY", "repository root changed after quota snapshot mutation");
  } catch (error) {
    didThrow = true;
    primary = error;
  }
  let cleanup: unknown;
  let cleanupThrown = false;
  for (const action of [
    () => {
      if (parentFd !== undefined) releaseFlock(parentFd);
    },
    () => {
      if (rootFd !== undefined) releaseFlock(rootFd);
    },
    () => {
      if (parentFd !== undefined) closeSync(parentFd);
    },
    () => {
      if (rootFd !== undefined) closeSync(rootFd);
    },
  ]) {
    try {
      action();
    } catch (error) {
      if (!cleanupThrown) {
        cleanup = error;
        cleanupThrown = true;
      }
    }
  }
  if (didThrow) throw primary;
  if (cleanupThrown) throw cleanup;
  return result;
}
