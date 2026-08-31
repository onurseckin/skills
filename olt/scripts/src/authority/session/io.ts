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
import { isJsonObject, type JsonObject } from "../../core/contracts/index.ts";
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

let inMemorySessionStore: Map<string, string> | undefined;

export function enableInMemorySessionStore(initial?: Record<string, string>): Map<string, string> {
  return (inMemorySessionStore = new Map(Object.entries(initial ?? {})));
}
export function disableInMemorySessionStore(): void {
  inMemorySessionStore = undefined;
}
export function clearInMemorySessionStore(): void {
  inMemorySessionStore?.clear();
}
export function isInMemorySessionStoreEnabled(): boolean {
  return inMemorySessionStore !== undefined;
}
export function getInMemorySessionStore(): Map<string, string> | undefined {
  return inMemorySessionStore;
}
export function setInMemorySessionData(path: string, payload: string): void {
  inMemorySessionStore?.set(path, payload);
}
export function getInMemorySessionData(path: string): string | undefined {
  return inMemorySessionStore?.get(path);
}
export function deleteInMemorySessionData(path: string): boolean {
  return inMemorySessionStore?.delete(path) ?? false;
}

export function secureReadSession(path: string): string {
  if (inMemorySessionStore) {
    const data = inMemorySessionStore.get(path);
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
  if (inMemorySessionStore) {
    sessionPersistenceObserver?.("file-fsync", path);
    inMemorySessionStore.set(path, payload);
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
  if (inMemorySessionStore) {
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

export function readOwnDataString(error: unknown, key: "code" | "message"): string | null {
  if ((typeof error !== "object" && typeof error !== "function") || error === null) return null;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, key);
    return descriptor && "value" in descriptor && typeof descriptor.value === "string"
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}

export function formatSafeErrorCause(error: unknown): string {
  const message = readOwnDataString(error, "message");
  if (message !== null) return message;
  if (error === null || (typeof error !== "object" && typeof error !== "function")) {
    try {
      return String(error);
    } catch {
      return "unknown error";
    }
  }
  return "unknown error";
}

export function readPersistedSession(
  path: string,
  mechanism: string,
  readSessionFile: (path: string, encoding: "utf8") => string,
): JsonObject | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readSessionFile(path, "utf8"));
  } catch (error: unknown) {
    if (readOwnDataString(error, "code") === "ENOENT") return null;
    throw new HarnessError(
      "INTEGRITY",
      `failed to read persisted ${mechanism} session evidence at ${path}: ${formatSafeErrorCause(error)}`,
    );
  }
  const invalid = (cause: string): never => {
    throw new HarnessError(
      "INTEGRITY",
      `invalid persisted ${mechanism} session evidence at ${path}: ${cause}`,
    );
  };
  const session: JsonObject = isJsonObject(parsed) ? parsed : invalid("expected a JSON object");
  if (typeof session.agent_id !== "string" || !session.agent_id.trim())
    invalid("agent_id must be a nonempty string");
  for (const f of ["role", "token"] as const) {
    if (f in session && (typeof session[f] !== "string" || !session[f].trim())) {
      invalid(`${f} must be a nonempty string when present`);
    }
  }
  for (const f of ["can_execute_shell", "can_edit_files"] as const) {
    if (f in session && typeof session[f] !== "boolean")
      invalid(`${f} must be a boolean when present`);
  }
  if (
    "write_scope" in session &&
    (!Array.isArray(session.write_scope) || session.write_scope.some((e) => typeof e !== "string"))
  ) {
    invalid("write_scope must be an array of strings when present");
  }
  for (const f of ["task_id", "granted_at"] as const) {
    if (f in session && typeof session[f] !== "string")
      invalid(`${f} must be a string when present`);
  }
  return session;
}

export function inferCanExecute(role: string): {
  can_execute_shell: boolean;
  can_edit_files: boolean;
} {
  const norm = role.trim().toLowerCase();
  const editable = [
    "implementer",
    "worker",
    "repairer",
    "owner",
    "sub-implementer",
    "sub_implementer",
    "sub-task-worker",
    "sub_task_worker",
  ];
  const isEditable =
    editable.includes(norm) || norm.startsWith("implementer-") || norm.startsWith("implementer_");
  return { can_execute_shell: true, can_edit_files: isEditable };
}

export function snapshotSession(path: string): SessionSnapshot {
  if (inMemorySessionStore) return { path, bytes: inMemorySessionStore.get(path) ?? null };
  return { path, bytes: existsSync(path) ? secureReadSession(path) : null };
}

export function restoreSnapshotIfUnchanged(snapshot: SessionSnapshot, payload: string): void {
  if (inMemorySessionStore) {
    const current = inMemorySessionStore.get(snapshot.path) ?? null;
    if (current !== payload) return;
    if (snapshot.bytes === null) inMemorySessionStore.delete(snapshot.path);
    else inMemorySessionStore.set(snapshot.path, snapshot.bytes);
    return;
  }
  const current = existsSync(snapshot.path) ? secureReadSession(snapshot.path) : null;
  if (current !== payload) return;
  if (snapshot.bytes === null) unlinkSync(snapshot.path);
  else writeFileSync(snapshot.path, snapshot.bytes, "utf8");
}
