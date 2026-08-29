import { randomBytes } from "node:crypto";
import {
  openSync,
  closeSync,
  readFileSync,
  writeSync,
  fsyncSync,
  renameSync,
  unlinkSync,
  lstatSync,
  fstatSync,
  statSync,
  readdirSync,
  existsSync,
  constants,
} from "node:fs";
import { dirname, join } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import type { TaskQueueItem } from "./types.ts";
import {
  deserializeTaskQueueItem,
  invokeTaskQueuePersistenceHook,
  resolveTaskQueuePath,
} from "./types.ts";
import { assertStableDirectory, withTaskQueueTransaction } from "./locks.ts";

export function isOwnCode(error: unknown, code: string): boolean {
  if (!(error instanceof Error)) return false;
  const descriptor = Object.getOwnPropertyDescriptor(error, "code");
  return descriptor?.value === code;
}

export function isOwnEnoent(error: unknown): boolean {
  return isOwnCode(error, "ENOENT");
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

export function serializeTaskQueue(items: readonly TaskQueueItem[]): string {
  return (
    items
      .map((item) =>
        JSON.stringify(deserializeTaskQueueItem(item as unknown as Record<string, unknown>)),
      )
      .join("\n") + (items.length > 0 ? "\n" : "")
  );
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

export function readTaskQueue(customPath?: string): TaskQueueItem[] {
  const filePath = resolveTaskQueuePath(customPath);
  return readTaskQueueFile(filePath);
}

export function loadTaskQueue(filePath?: string): TaskQueueItem[] {
  return readTaskQueue(filePath);
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
      if (written <= 0) {
        throw new HarnessError("INTEGRITY", "could not completely write task queue");
      }
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

export function writeTaskQueueUnlocked(items: readonly TaskQueueItem[], filePath: string): void {
  const raw = serializeTaskQueue(items);
  atomicReplaceTaskQueue(filePath, raw);
}

export function writeTaskQueue(items: readonly TaskQueueItem[], customPath?: string): void {
  const filePath = resolveTaskQueuePath(customPath);
  withTaskQueueTransaction(filePath, () => writeTaskQueueUnlocked(items, filePath));
}

export function saveTaskQueue(tasks: readonly TaskQueueItem[], filePath?: string): void {
  writeTaskQueue(tasks, filePath);
}

export function clearTaskQueue(customPath?: string): void {
  const filePath = resolveTaskQueuePath(customPath);
  withTaskQueueTransaction(filePath, () => writeTaskQueueUnlocked([], filePath));
}

export function cleanStaleTempFiles(targetDir: string, maxAgeMs = 60_000): number {
  if (!existsSync(targetDir)) return 0;
  let cleaned = 0;
  const now = Date.now();
  try {
    const entries = readdirSync(targetDir);
    for (const entry of entries) {
      if (entry.startsWith(".task-queue.") && entry.endsWith(".tmp")) {
        const fullPath = join(targetDir, entry);
        try {
          const st = statSync(fullPath);
          if (now - st.mtimeMs > maxAgeMs) {
            unlinkSync(fullPath);
            cleaned++;
          }
        } catch {}
      }
    }
  } catch {}
  return cleaned;
}
