import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  writeSync,
  type Stats,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { HarnessError } from "../../core/errors/index.ts";
import { releaseFlock, tryExclusiveFlock } from "../../platform/index.ts";
import {
  assertRealDirectory,
  assertSingleLinkRegular,
  noFollow,
  openVerifiedDirectory,
  sameInode,
} from "./paths.ts";
import { sessionLockCleanupFault, sessionPersistenceObserver } from "./testing-hooks.ts";
import type { SessionSnapshot } from "./types.ts";
import {
  deleteInMemorySessionData,
  getInMemorySessionData,
  isInMemorySessionStoreEnabled,
  setInMemorySessionData,
} from "./in-memory-store.ts";

export {
  clearInMemorySessionStore,
  deleteInMemorySessionData,
  disableInMemorySessionStore,
  enableInMemorySessionStore,
  getInMemorySessionData,
  getInMemorySessionStore,
  isInMemorySessionStoreEnabled,
  setInMemorySessionData,
} from "./in-memory-store.ts";

export {
  formatSafeErrorCause,
  inferCanExecute,
  readOwnDataString,
  readPersistedSession,
} from "./session-validation.ts";

export function secureReadSession(path: string): string {
  if (isInMemorySessionStoreEnabled()) {
    const data = getInMemorySessionData(path);
    if (data === undefined) throw Object.assign(new Error("missing session"), { code: "ENOENT" });
    return data;
  }
  const before = assertSingleLinkRegular(path);
  if (!before) throw Object.assign(new Error("missing session"), { code: "ENOENT" });
  const fd = openSync(path, constants.O_RDONLY | noFollow());
  try {
    const opened = fstatSync(fd);
    const after = assertSingleLinkRegular(path);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      !after ||
      !sameInode(before, opened) ||
      !sameInode(opened, after)
    ) {
      throw new HarnessError("INTEGRITY", `session authority changed while opening: ${path}`);
    }
    return readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }
}

export function atomicSessionWrite(path: string, payload: string): void {
  if (isInMemorySessionStoreEnabled()) {
    sessionPersistenceObserver?.("file-fsync", path);
    setInMemorySessionData(path, payload);
    sessionPersistenceObserver?.("rename", path);
    sessionPersistenceObserver?.("directory-fsync", path);
    return;
  }
  assertSingleLinkRegular(path);
  const parent = dirname(path);
  const temporary = join(parent, `.${basename(path)}.${randomUUID()}.tmp`);
  let fd: number | undefined;
  try {
    fd = openSync(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow(),
      0o600,
    );
    const bytes = Buffer.from(payload);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const wrote = writeSync(fd, bytes, offset, bytes.byteLength - offset);
      if (wrote <= 0)
        throw new HarnessError("INTEGRITY", "session authority write made no progress");
      offset += wrote;
    }
    fsyncSync(fd);
    sessionPersistenceObserver?.("file-fsync", path);
    closeSync(fd);
    fd = undefined;
    assertSingleLinkRegular(path);
    renameSync(temporary, path);
    sessionPersistenceObserver?.("rename", path);
    const directory = openSync(
      parent,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | noFollow(),
    );
    try {
      fsyncSync(directory);
      sessionPersistenceObserver?.("directory-fsync", path);
    } finally {
      closeSync(directory);
    }
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temporary)) rmSync(temporary);
    throw error;
  }
}

export function withSessionAuthorityLock<T>(
  repoRoot: string,
  directory: string,
  operation: () => T,
): T {
  if (isInMemorySessionStoreEnabled()) {
    let result!: T;
    let primary: unknown;
    let hasPrimary = false;
    try {
      result = operation();
    } catch (error) {
      hasPrimary = true;
      primary = error;
    }
    let cleanup: unknown;
    let hasCleanup = false;
    try {
      if (sessionLockCleanupFault.enabled) throw sessionLockCleanupFault.value;
    } catch (error) {
      hasCleanup = true;
      cleanup = error;
    }
    if (hasPrimary) throw primary;
    if (hasCleanup) throw cleanup;
    return result;
  }
  const root = openVerifiedDirectory(repoRoot, false, "session repository root");
  let session: { fd: number; stat: Stats } | undefined;
  let rootLocked = false;
  let sessionLocked = false;
  let primary: unknown;
  let hasPrimary = false;
  let cleanup: unknown;
  let hasCleanup = false;
  let result!: T;
  try {
    if (!tryExclusiveFlock(root.fd))
      throw new HarnessError("LOCK_TIMEOUT", "session repository lock is busy");
    rootLocked = true;
    assertRealDirectory(dirname(directory), "session authority parent");
    session = openVerifiedDirectory(directory, true, "session authority directory");
    if (!tryExclusiveFlock(session.fd))
      throw new HarnessError("LOCK_TIMEOUT", "session directory lock is busy");
    sessionLocked = true;
    if (
      !sameInode(root.stat, assertRealDirectory(repoRoot, "session repository root")) ||
      !sameInode(session.stat, assertRealDirectory(directory, "session authority directory"))
    ) {
      throw new HarnessError("INTEGRITY", "session authority changed while locked");
    }
    result = operation();
  } catch (error) {
    hasPrimary = true;
    primary = error;
  }
  for (const action of [
    () => {
      if (sessionLockCleanupFault.enabled) throw sessionLockCleanupFault.value;
      if (session && sessionLocked) releaseFlock(session.fd);
    },
    () => {
      if (session) closeSync(session.fd);
    },
    () => {
      if (rootLocked) releaseFlock(root.fd);
    },
    () => closeSync(root.fd),
  ]) {
    try {
      action();
    } catch (error) {
      if (!hasCleanup) {
        hasCleanup = true;
        cleanup = error;
      }
    }
  }
  if (hasPrimary) throw primary;
  if (hasCleanup) throw cleanup;
  return result;
}

export function snapshotSession(path: string): SessionSnapshot {
  if (isInMemorySessionStoreEnabled()) return { path, bytes: getInMemorySessionData(path) ?? null };
  return { path, bytes: existsSync(path) ? secureReadSession(path) : null };
}

export function restoreSnapshotIfUnchanged(snapshot: SessionSnapshot, payload: string): void {
  if (isInMemorySessionStoreEnabled()) {
    const current = getInMemorySessionData(snapshot.path) ?? null;
    if (current !== payload) return;
    if (snapshot.bytes === null) deleteInMemorySessionData(snapshot.path);
    else setInMemorySessionData(snapshot.path, snapshot.bytes);
    return;
  }
  const current = existsSync(snapshot.path) ? secureReadSession(snapshot.path) : null;
  if (current !== payload) return;
  if (snapshot.bytes === null) unlinkSync(snapshot.path);
  else writeFileSync(snapshot.path, snapshot.bytes, "utf8");
}
