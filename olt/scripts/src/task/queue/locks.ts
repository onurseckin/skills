import { openSync, closeSync, lstatSync, fstatSync, mkdirSync, constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { releaseFlock, tryExclusiveFlock } from "../../platform/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { taskQueueLockSleep } from "./types.ts";

export const activeProcessInodes = new Set<string>();

function isOwnErrorCode(error: unknown, code: string): boolean {
  if (!(error instanceof Error)) return false;
  const descriptor = Object.getOwnPropertyDescriptor(error, "code");
  return descriptor?.value === code;
}

export function assertStableDirectory(path: string, descriptor: number, label: string): void {
  const before = lstatSync(path);
  const opened = fstatSync(descriptor);
  if (
    !before.isDirectory() ||
    !opened.isDirectory() ||
    before.dev !== opened.dev ||
    before.ino !== opened.ino
  ) {
    throw new HarnessError("INTEGRITY", `${label} directory changed while being opened`);
  }
}

export function acquireTaskQueueFlock(descriptor: number, label: string): boolean {
  const stat = fstatSync(descriptor);
  const key = `${stat.dev}:${stat.ino}`;
  if (activeProcessInodes.has(key)) return false;
  for (let attempt = 0; attempt < 200; attempt++) {
    if (tryExclusiveFlock(descriptor)) {
      activeProcessInodes.add(key);
      return true;
    }
    Atomics.wait(taskQueueLockSleep, 0, 0, 5);
  }
  throw new HarnessError("LOCK_TIMEOUT", `${label} is already locked`);
}

export function releaseTaskQueueFlock(descriptor: number): void {
  try {
    const stat = fstatSync(descriptor);
    activeProcessInodes.delete(`${stat.dev}:${stat.ino}`);
  } catch {}
  releaseFlock(descriptor);
}

export function resolveTaskQueueLockPath(filePath: string): string {
  const resolved = resolve(filePath);
  const dir = dirname(resolved);
  if (dir.endsWith(".olt") || dir.includes("/.olt/")) {
    const oltDir = dir.endsWith(".olt") ? dir : dir.slice(0, dir.indexOf("/.olt/") + 5);
    return join(oltDir, "locks", "tasks.lock");
  }
  return join(dir, ".task-queue.lock");
}

export function withTaskQueueTransaction<T>(filePath: string, mutation: () => T): T {
  const parent = dirname(filePath);
  const parentRoot = dirname(parent);
  const root = parentRoot === parent || parentRoot === "/" ? parent : parentRoot;
  let rootFd: number | undefined;
  let parentFd: number | undefined;
  let rootLocked = false;
  let parentLocked = false;
  let primaryThrown = false;
  let primary: unknown;
  let result!: T;
  try {
    rootFd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    assertStableDirectory(root, rootFd, "task queue root");
    rootLocked = acquireTaskQueueFlock(rootFd, "task queue root");
    assertStableDirectory(root, rootFd, "task queue root");
    try {
      mkdirSync(parent, { recursive: true });
    } catch (error) {
      if (!isOwnErrorCode(error, "EEXIST")) throw error;
    }
    assertStableDirectory(root, rootFd, "task queue root");
    parentFd = openSync(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    assertStableDirectory(parent, parentFd, "task queue parent");
    parentLocked = acquireTaskQueueFlock(parentFd, "task queue parent");
    assertStableDirectory(parent, parentFd, "task queue parent");
    result = mutation();
  } catch (error) {
    primaryThrown = true;
    primary = error;
  }

  let cleanupThrown = false;
  let cleanup: unknown;
  const attemptCleanup = (action: () => void): void => {
    try {
      action();
    } catch (error) {
      if (!cleanupThrown) {
        cleanupThrown = true;
        cleanup = error;
      }
    }
  };
  if (parentLocked && parentFd !== undefined)
    attemptCleanup(() => releaseTaskQueueFlock(parentFd!));
  if (rootLocked && rootFd !== undefined) attemptCleanup(() => releaseTaskQueueFlock(rootFd!));
  if (parentFd !== undefined) attemptCleanup(() => closeSync(parentFd!));
  if (rootFd !== undefined) attemptCleanup(() => closeSync(rootFd!));
  if (primaryThrown) throw primary;
  if (cleanupThrown) throw cleanup;
  return result;
}

export async function withTaskQueueLock<T>(filePath: string, fn: () => T | Promise<T>): Promise<T> {
  const parent = dirname(filePath);
  const parentRoot = dirname(parent);
  const root = parentRoot === parent || parentRoot === "/" ? parent : parentRoot;
  let rootFd: number | undefined;
  let parentFd: number | undefined;
  let rootLocked = false;
  let parentLocked = false;
  let primaryThrown = false;
  let primary: unknown;
  let result!: T;
  try {
    rootFd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    assertStableDirectory(root, rootFd, "task queue root");
    rootLocked = acquireTaskQueueFlock(rootFd, "task queue root");
    assertStableDirectory(root, rootFd, "task queue root");
    try {
      mkdirSync(parent, { recursive: true });
    } catch (error) {
      if (!isOwnErrorCode(error, "EEXIST")) throw error;
    }
    assertStableDirectory(root, rootFd, "task queue root");
    parentFd = openSync(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    assertStableDirectory(parent, parentFd, "task queue parent");
    parentLocked = acquireTaskQueueFlock(parentFd, "task queue parent");
    assertStableDirectory(parent, parentFd, "task queue parent");
    result = await fn();
  } catch (error) {
    primaryThrown = true;
    primary = error;
  }

  let cleanupThrown = false;
  let cleanup: unknown;
  const attemptCleanup = (action: () => void): void => {
    try {
      action();
    } catch (error) {
      if (!cleanupThrown) {
        cleanupThrown = true;
        cleanup = error;
      }
    }
  };
  if (parentLocked && parentFd !== undefined)
    attemptCleanup(() => releaseTaskQueueFlock(parentFd!));
  if (rootLocked && rootFd !== undefined) attemptCleanup(() => releaseTaskQueueFlock(rootFd!));
  if (parentFd !== undefined) attemptCleanup(() => closeSync(parentFd!));
  if (rootFd !== undefined) attemptCleanup(() => closeSync(rootFd!));
  if (primaryThrown) throw primary;
  if (cleanupThrown) throw cleanup;
  return result;
}
