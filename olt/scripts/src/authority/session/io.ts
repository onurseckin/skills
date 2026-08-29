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

export function secureReadSession(path: string): string {
  const before = assertSingleLinkRegular(path);
  if (!before) {
    const error = Object.assign(new Error("missing session"), { code: "ENOENT" });
    throw error;
  }
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
      if (wrote <= 0) throw new HarnessError("INTEGRITY", "session authority write made no progress");
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

export function withSessionAuthorityLock<T>(repoRoot: string, directory: string, operation: () => T): T {
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
    if (!tryExclusiveFlock(root.fd)) {
      throw new HarnessError("LOCK_TIMEOUT", "session repository lock is busy");
    }
    rootLocked = true;
    const olt = dirname(directory);
    assertRealDirectory(olt, "session authority parent");
    session = openVerifiedDirectory(directory, true, "session authority directory");
    if (!tryExclusiveFlock(session.fd)) {
      throw new HarnessError("LOCK_TIMEOUT", "session directory lock is busy");
    }
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
  if ((typeof error !== "object" && typeof error !== "function") || error === null) {
    return null;
  }
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
    if (readOwnDataString(error, "code") === "ENOENT") {
      return null;
    }
    throw new HarnessError(
      "INTEGRITY",
      `failed to read persisted ${mechanism} session evidence at ${path}: ${formatSafeErrorCause(error)}`,
    );
  }

  const invalid = (cause: string): never => {
    throw new HarnessError("INTEGRITY", `invalid persisted ${mechanism} session evidence at ${path}: ${cause}`);
  };

  const session: JsonObject = isJsonObject(parsed) ? parsed : invalid("expected a JSON object");
  if (typeof session.agent_id !== "string" || !session.agent_id.trim()) {
    invalid("agent_id must be a nonempty string");
  }
  for (const field of ["role", "token"] as const) {
    if (field in session && (typeof session[field] !== "string" || !session[field].trim())) {
      invalid(`${field} must be a nonempty string when present`);
    }
  }
  for (const field of ["can_execute_shell", "can_edit_files"] as const) {
    if (field in session && typeof session[field] !== "boolean") {
      invalid(`${field} must be a boolean when present`);
    }
  }
  if (
    "write_scope" in session &&
    (!Array.isArray(session.write_scope) || session.write_scope.some((entry) => typeof entry !== "string"))
  ) {
    invalid("write_scope must be an array of strings when present");
  }
  for (const field of ["task_id", "granted_at"] as const) {
    if (field in session && typeof session[field] !== "string") {
      invalid(`${field} must be a string when present`);
    }
  }
  return session;
}

export function inferCanExecute(role: string): { can_execute_shell: boolean; can_edit_files: boolean } {
  const normalized = role.trim().toLowerCase();
  if (
    normalized === "validator" ||
    normalized === "cognitive-validator" ||
    normalized === "cognitive_validator" ||
    normalized.startsWith("validator-") ||
    normalized === "critic" ||
    normalized === "completeness-critic" ||
    normalized === "completeness_critic" ||
    normalized === "plan-validator" ||
    normalized === "plan_validator" ||
    normalized === "sub-investigator"
  ) {
    return { can_execute_shell: false, can_edit_files: false };
  }
  if (
    normalized === "mind" ||
    normalized === "orchestrator" ||
    normalized === "coordinator" ||
    normalized === "meta-auditor" ||
    normalized === "meta_auditor"
  ) {
    return { can_execute_shell: true, can_edit_files: false };
  }
  return { can_execute_shell: true, can_edit_files: true };
}

export function snapshotSession(path: string): SessionSnapshot {
  return { path, bytes: existsSync(path) ? secureReadSession(path) : null };
}

export function restoreSnapshotIfUnchanged(snapshot: SessionSnapshot, payload: string): void {
  const current = existsSync(snapshot.path) ? secureReadSession(snapshot.path) : null;
  if (current !== payload) return;
  if (snapshot.bytes === null) {
    unlinkSync(snapshot.path);
  } else {
    writeFileSync(snapshot.path, snapshot.bytes, "utf8");
  }
}
