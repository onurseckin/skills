import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { HarnessError } from "../../../core/errors/index.ts";
import { releaseFlock, tryExclusiveFlock } from "../../../platform/index.ts";
import {
  isOwnEnoent,
  parseFeedbackQueue,
  readFeedbackQueueFile,
  readFeedbackQueueStrict,
  strictFeedbackItem,
} from "./ingest.ts";
import type { FeedbackItem } from "./types.ts";
import {
  invokeFeedbackQueuePersistenceHook,
  noFollowFlag,
  resolveFeedbackQueuePath,
  sortFeedbackByPriority,
} from "./types.ts";

const feedbackQueueLockSleep = new Int32Array(new SharedArrayBuffer(4));
export const activeFeedbackInodes = new Set<string>();

export function writeFeedbackQueue(items: readonly FeedbackItem[], customPath?: string): void {
  withFeedbackQueueTransaction(customPath, () => ({ items, result: undefined }));
}

function writeFeedbackQueueUnlocked(items: readonly FeedbackItem[], filePath: string): void {
  const canonical = items.map((item, index) => strictFeedbackItem(item, index + 1));
  const ids = new Set<string>();
  for (const item of canonical) {
    if (ids.has(item.id))
      throw new HarnessError("INTEGRITY", `feedback queue duplicates id '${item.id}'`);
    ids.add(item.id);
  }
  atomicReplaceFeedbackQueue(
    filePath,
    canonical.map((item) => JSON.stringify(item)).join("\n") + (canonical.length ? "\n" : ""),
  );
}

function assertStableFeedbackDirectory(path: string, descriptor: number, label: string): void {
  const pathStat = lstatSync(path);
  const opened = fstatSync(descriptor);
  if (
    !pathStat.isDirectory() ||
    !opened.isDirectory() ||
    pathStat.dev !== opened.dev ||
    pathStat.ino !== opened.ino
  )
    throw new HarnessError("INTEGRITY", `${label} directory changed while being opened`);
}

function acquireFeedbackQueueFlock(descriptor: number, label: string): boolean {
  const stat = fstatSync(descriptor);
  const key = `${stat.dev}:${stat.ino}`;
  if (activeFeedbackInodes.has(key)) return false;
  for (let attempt = 0; attempt < 200; attempt++) {
    if (tryExclusiveFlock(descriptor)) {
      activeFeedbackInodes.add(key);
      return true;
    }
    Atomics.wait(feedbackQueueLockSleep, 0, 0, 5);
  }
  throw new HarnessError("LOCK_TIMEOUT", `${label} is already locked`);
}

function releaseFeedbackQueueFlock(descriptor: number): void {
  try {
    const stat = fstatSync(descriptor);
    activeFeedbackInodes.delete(`${stat.dev}:${stat.ino}`);
  } catch {}
  releaseFlock(descriptor);
}

/** Runs one feedback-ledger mutation under stable root and parent inode locks. */
export function withFeedbackQueueTransaction<T>(
  customPath: string | undefined,
  mutation: (items: readonly FeedbackItem[]) => {
    readonly items: readonly FeedbackItem[];
    readonly result: T;
  },
): T {
  const filePath = resolveFeedbackQueuePath(customPath);
  const parent = dirname(filePath);
  const candidateRoot = dirname(parent);
  const root = candidateRoot === parent || candidateRoot === "/" ? parent : candidateRoot;
  let rootFd: number | undefined;
  let parentFd: number | undefined;
  let rootLocked = false;
  let parentLocked = false;
  let result!: T;
  let primary: unknown;
  try {
    rootFd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | noFollowFlag());
    assertStableFeedbackDirectory(root, rootFd, "feedback queue root");
    rootLocked = acquireFeedbackQueueFlock(rootFd, "feedback queue root");
    assertStableFeedbackDirectory(root, rootFd, "feedback queue root");
    try {
      mkdirSync(parent, { recursive: true });
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          Object.getOwnPropertyDescriptor(error, "code")?.value === "EEXIST"
        )
      )
        throw error;
    }
    parentFd = openSync(parent, constants.O_RDONLY | constants.O_DIRECTORY | noFollowFlag());
    assertStableFeedbackDirectory(parent, parentFd, "feedback queue parent");
    parentLocked = acquireFeedbackQueueFlock(parentFd, "feedback queue parent");
    assertStableFeedbackDirectory(parent, parentFd, "feedback queue parent");
    const existing = parseFeedbackQueue(readFeedbackQueueFile(filePath));
    const next = mutation(existing);
    writeFeedbackQueueUnlocked(next.items, filePath);
    result = next.result;
  } catch (error) {
    primary = error;
  }
  let cleanup: unknown;
  const tryCleanup = (action: () => void): void => {
    try {
      action();
    } catch (error) {
      if (cleanup === undefined) cleanup = error;
    }
  };
  if (parentLocked && parentFd !== undefined)
    tryCleanup(() => releaseFeedbackQueueFlock(parentFd!));
  if (rootLocked && rootFd !== undefined) tryCleanup(() => releaseFeedbackQueueFlock(rootFd!));
  if (parentFd !== undefined) tryCleanup(() => closeSync(parentFd!));
  if (rootFd !== undefined) tryCleanup(() => closeSync(rootFd!));
  if (primary !== undefined) throw primary;
  if (cleanup !== undefined) throw cleanup;
  return result;
}

function atomicReplaceFeedbackQueue(filePath: string, raw: string): void {
  const parent = dirname(filePath);
  let previous: { readonly dev: number; readonly ino: number } | undefined;
  try {
    const existing = lstatSync(filePath);
    if (!existing.isFile() || existing.nlink !== 1)
      throw new HarnessError("INTEGRITY", "feedback queue must be a single-link regular file");
    previous = { dev: existing.dev, ino: existing.ino };
  } catch (error) {
    if (!isOwnEnoent(error)) throw error;
  }
  const temporary = join(
    parent,
    `.feedback-queue.${process.pid}.${randomBytes(12).toString("hex")}.tmp`,
  );
  let tempFd: number | undefined;
  let parentFd: number | undefined;
  let renamed = false;
  try {
    tempFd = openSync(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag(),
      0o600,
    );
    const bytes = Buffer.from(raw, "utf8");
    for (let offset = 0; offset < bytes.length;) {
      invokeFeedbackQueuePersistenceHook("before_write");
      const written = writeSync(tempFd, bytes, offset, bytes.length - offset);
      if (written <= 0)
        throw new HarnessError("INTEGRITY", "could not completely write feedback queue");
      offset += written;
    }
    invokeFeedbackQueuePersistenceHook("before_file_fsync");
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
      )
        throw new HarnessError("INTEGRITY", "feedback queue changed before replacement");
    } catch (error) {
      if (!(previous === undefined && isOwnEnoent(error))) throw error;
    }
    invokeFeedbackQueuePersistenceHook("before_rename");
    renameSync(temporary, filePath);
    renamed = true;
    invokeFeedbackQueuePersistenceHook("after_rename");
    parentFd = openSync(parent, constants.O_RDONLY | constants.O_DIRECTORY | noFollowFlag());
    assertStableFeedbackDirectory(parent, parentFd, "feedback queue parent");
    invokeFeedbackQueuePersistenceHook("before_directory_fsync");
    fsyncSync(parentFd);
  } catch (error) {
    if (renamed)
      throw new HarnessError(
        "INTEGRITY",
        "feedback queue mutation outcome is uncertain and possibly committed after rename",
      );
    throw error;
  } finally {
    if (tempFd !== undefined) closeSync(tempFd);
    if (parentFd !== undefined) closeSync(parentFd);
    if (!renamed) {
      try {
        unlinkSync(temporary);
      } catch (error) {
        if (!isOwnEnoent(error)) throw error;
      }
    }
  }
}
