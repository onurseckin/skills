import { pruneCompletedTasksUnlocked } from "./pruner.ts";
export const activeProcessInodes = new Set<string>();
import { randomBytes } from "node:crypto";
import {
  DEFAULT_MAX_RETRIES,
  DEFAULT_LEASE_DURATION_MS,
  DEFAULT_LEASE_DURATION_SECONDS,
  PRIORITY_WEIGHTS,
} from "./types.ts";
import {
  existsSync,
  readFileSync,
  openSync,
  closeSync,
  unlinkSync,
  renameSync,
  lstatSync,
  fstatSync,
  writeSync,
  fsyncSync,
  mkdirSync,
  constants,
} from "node:fs";
import { dirname, join } from "node:path";
import { releaseFlock, tryExclusiveFlock } from "../../../platform/index.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import type { TaskQueueItem, TaskQueueStatus, TaskPriority, TaskSourceType } from "./types.ts";
import {
  resolveTaskQueuePath,
  DEFAULT_TASK_QUEUE_FILE,
  invokeTaskQueuePersistenceHook,
  deserializeTaskQueueItem,
  taskQueueLockSleep,
} from "./types.ts";
export function readTaskQueue(customPath?: string): TaskQueueItem[] {
  const filePath = resolveTaskQueuePath(customPath);
  return readTaskQueueFile(filePath);
}

export function readTaskQueueFile(filePath: string): TaskQueueItem[] {
  let descriptor: number | undefined;
  try {
    const before = lstatSync(filePath);
    if (!before.isFile() || before.nlink !== 1) {
      throw new HarnessError("INTEGRITY", "task queue must be a single-link regular file");
    }
    descriptor = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino
    ) {
      throw new HarnessError("INTEGRITY", "task queue changed while being opened");
    }
    const raw = readFileSync(descriptor, "utf8");
    const after = lstatSync(filePath);
    if (
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      !after.isFile() ||
      after.nlink !== 1
    ) {
      throw new HarnessError("INTEGRITY", "task queue changed while being read");
    }
    return parseTaskQueue(raw);
  } catch (error) {
    if (isOwnEnoent(error)) return [];
    if (error instanceof HarnessError) throw error;
    throw new HarnessError("INTEGRITY", "could not securely read task queue");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function parseTaskQueue(raw: string): TaskQueueItem[] {
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const items: TaskQueueItem[] = [];

  for (const [index, line] of lines.entries()) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      items.push(deserializeTaskQueueItem(parsed));
    } catch (error) {
      if (error instanceof HarnessError) throw error;
      throw new HarnessError("INTEGRITY", `task queue line ${index + 1} is malformed`);
    }
  }

  return items;
}

/**
 * Writes task items atomically to the task queue storage.
 */
export function writeTaskQueue(items: readonly TaskQueueItem[], customPath?: string): void {
  const filePath = resolveTaskQueuePath(customPath);
  withTaskQueueTransaction(filePath, () => writeTaskQueueUnlocked(items, filePath));
}

export function writeTaskQueueUnlocked(items: readonly TaskQueueItem[], filePath: string): void {
  const raw = serializeTaskQueue(items);
  atomicReplaceTaskQueue(filePath, raw);
}

export function serializeTaskQueue(items: readonly TaskQueueItem[]): string {
  return (
    items
      .map((item) =>
        JSON.stringify(deserializeTaskQueueItem(item as unknown as Record<string, unknown>)),
      )
      .join("\n") + (items.length > 0 ? "\n" : "")
  );
}

/**
 * Clears all items in the task queue.
 */
export function clearTaskQueue(customPath?: string): void {
  const filePath = resolveTaskQueuePath(customPath);
  withTaskQueueTransaction(filePath, () => writeTaskQueueUnlocked([], filePath));
}

export function isOwnEnoent(error: unknown): boolean {
  return isOwnCode(error, "ENOENT");
}

export function isOwnCode(error: unknown, code: string): boolean {
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

/** Runs a queue mutation under stable repository and queue-parent inode locks. */
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
      mkdirSync(parent);
    } catch (error) {
      if (!isOwnCode(error, "EEXIST")) throw error;
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
  if (parentLocked && parentFd !== undefined) attemptCleanup(() => releaseFlock(parentFd!));
  if (rootLocked && rootFd !== undefined) attemptCleanup(() => releaseFlock(rootFd!));
  if (parentFd !== undefined) attemptCleanup(() => closeSync(parentFd!));
  if (rootFd !== undefined) attemptCleanup(() => closeSync(rootFd!));
  if (primaryThrown) throw primary;
  if (cleanupThrown) throw cleanup;
  return result;
}

export function atomicReplaceTaskQueue(filePath: string, raw: string): void {
  const parent = dirname(filePath);
  let previous: { readonly dev: number; readonly ino: number } | undefined;
  try {
    const existing = lstatSync(filePath);
    if (!existing.isFile() || existing.nlink !== 1) {
      throw new HarnessError("INTEGRITY", "task queue must be a single-link regular file");
    }
    previous = { dev: existing.dev, ino: existing.ino };
  } catch (error) {
    if (!isOwnEnoent(error)) throw error;
  }

  const temporary = join(
    parent,
    `.task-queue.${process.pid}.${randomBytes(12).toString("hex")}.tmp`,
  );
  let tempFd: number | undefined;
  let dirFd: number | undefined;
  let renamed = false;
  try {
    tempFd = openSync(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    const bytes = Buffer.from(raw, "utf8");
    let offset = 0;
    while (offset < bytes.length) {
      invokeTaskQueuePersistenceHook("before_write");
      const written = writeSync(tempFd, bytes, offset, bytes.length - offset);
      if (written <= 0)
        throw new HarnessError("INTEGRITY", "could not completely write task queue");
      offset += written;
    }
    invokeTaskQueuePersistenceHook("before_fsync");
    fsyncSync(tempFd);
    closeSync(tempFd);
    tempFd = undefined;
    try {
      const current = lstatSync(filePath);
      if (
        !previous ||
        !current.isFile() ||
        current.nlink !== 1 ||
        current.dev !== previous.dev ||
        current.ino !== previous.ino
      ) {
        throw new HarnessError("INTEGRITY", "task queue changed before replacement");
      }
    } catch (error) {
      if (!(previous === undefined && isOwnEnoent(error))) throw error;
    }
    invokeTaskQueuePersistenceHook("before_rename");
    renameSync(temporary, filePath);
    renamed = true;
    invokeTaskQueuePersistenceHook("after_rename");
    dirFd = openSync(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    assertStableDirectory(parent, dirFd, "task queue parent");
    invokeTaskQueuePersistenceHook("before_directory_fsync");
    fsyncSync(dirFd);
  } catch (error) {
    if (renamed) {
      throw new HarnessError(
        "INTEGRITY",
        "task queue mutation outcome is uncertain and possibly committed after rename",
      );
    }
    throw error;
  } finally {
    if (tempFd !== undefined) closeSync(tempFd);
    if (dirFd !== undefined) closeSync(dirFd);
    if (!renamed) {
      try {
        unlinkSync(temporary);
      } catch (error) {
        if (!isOwnEnoent(error)) throw error;
      }
    }
  }
}

/**
 * Validates task dependency DAG for circular dependencies using depth-first search.
 */
