import * as fs from "node:fs";
import type { Stats } from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { isJsonObject, type JsonObject } from "../../core/contracts/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { releaseFlock, tryExclusiveFlock } from "../../platform/index.ts";
import * as paths from "./paths.ts";
import { sessionLockCleanupFault, sessionPersistenceObserver } from "./testing-hooks.ts";
import type { SessionSnapshot } from "./types.ts";

import {
  clearInMemorySessionStore,
  deleteInMemorySessionData,
  disableInMemorySessionStore,
  enableInMemorySessionStore,
  getInMemorySessionData,
  getInMemorySessionStore,
  isInMemorySessionStoreEnabled,
  setInMemorySessionData,
} from "./paths.ts";

export {
  clearInMemorySessionStore,
  deleteInMemorySessionData,
  disableInMemorySessionStore,
  enableInMemorySessionStore,
  getInMemorySessionData,
  getInMemorySessionStore,
  isInMemorySessionStoreEnabled,
  setInMemorySessionData,
};

export function readOwnDataString(err: unknown, key: "code" | "message"): string | null {
  try {
    const d = err && typeof err === "object" ? Object.getOwnPropertyDescriptor(err, key) : null;
    return d && typeof d.value === "string" ? d.value : null;
  } catch {
    return null;
  }
}

export function formatSafeErrorCause(err: unknown): string {
  const msg = readOwnDataString(err, "message");
  return msg !== null ? msg : !err || typeof err !== "object" ? String(err) : "unknown error";
}

export function readPersistedSession(
  path: string,
  mech: string,
  readSessionFile: (p: string, enc: "utf8") => string,
): JsonObject | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readSessionFile(path, "utf8"));
  } catch (err: unknown) {
    if (readOwnDataString(err, "code") === "ENOENT") return null;
    throw new HarnessError(
      "INTEGRITY",
      `failed to read persisted ${mech} session evidence at ${path}: ${formatSafeErrorCause(err)}`,
    );
  }
  const fail = (c: string): never => {
    throw new HarnessError(
      "INTEGRITY",
      `invalid persisted ${mech} session evidence at ${path}: ${c}`,
    );
  };
  const s = isJsonObject(parsed) ? parsed : fail("expected a JSON object");
  if (typeof s.agent_id !== "string" || !s.agent_id.trim())
    fail("agent_id must be a nonempty string");
  for (const f of ["role", "token"] as const)
    if (f in s && (typeof s[f] !== "string" || !(s[f] as string).trim()))
      fail(`${f} must be a nonempty string when present`);
  for (const f of ["can_execute_shell", "can_edit_files"] as const)
    if (f in s && typeof s[f] !== "boolean") fail(`${f} must be a boolean when present`);
  if (
    "write_scope" in s &&
    (!Array.isArray(s.write_scope) || s.write_scope.some((e) => typeof e !== "string"))
  )
    fail("write_scope must be an array of strings when present");
  for (const f of ["task_id", "granted_at"] as const)
    if (f in s && typeof s[f] !== "string") fail(`${f} must be a string when present`);
  return s;
}

const EDIT_ROLES = new Set([
  "implementer",
  "worker",
  "repairer",
  "owner",
  "sub-implementer",
  "sub_implementer",
  "sub-task-worker",
  "sub_task_worker",
]);
export function inferCanExecute(role: string): {
  can_execute_shell: boolean;
  can_edit_files: boolean;
} {
  const norm = role.trim().toLowerCase();
  return {
    can_execute_shell: true,
    can_edit_files:
      EDIT_ROLES.has(norm) || norm.startsWith("implementer-") || norm.startsWith("implementer_"),
  };
}

export function secureReadSession(path: string): string {
  if (isInMemorySessionStoreEnabled()) {
    const data = getInMemorySessionData(path);
    if (data === undefined) throw Object.assign(new Error("missing session"), { code: "ENOENT" });
    return data;
  }
  const before = paths.assertSingleLinkRegular(path);
  if (!before) throw Object.assign(new Error("missing session"), { code: "ENOENT" });
  const fd = fs.openSync(path, fs.constants.O_RDONLY | paths.noFollow());
  try {
    const opened = fs.fstatSync(fd),
      after = paths.assertSingleLinkRegular(path);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      !after ||
      !paths.sameInode(before, opened) ||
      !paths.sameInode(opened, after)
    ) {
      throw new HarnessError("INTEGRITY", `session authority changed while opening: ${path}`);
    }
    return fs.readFileSync(fd, "utf8");
  } finally {
    fs.closeSync(fd);
  }
}

export function atomicSessionWrite(path: string, payload: string): void {
  const obs = sessionPersistenceObserver;
  if (isInMemorySessionStoreEnabled()) {
    obs?.("file-fsync", path);
    setInMemorySessionData(path, payload);
    obs?.("rename", path);
    obs?.("directory-fsync", path);
    return;
  }
  paths.assertSingleLinkRegular(path);
  const parent = dirname(path),
    tmp = join(parent, `.${basename(path)}.${randomUUID()}.tmp`);
  let fd: number | undefined;
  try {
    fd = fs.openSync(
      tmp,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | paths.noFollow(),
      0o600,
    );
    const buf = Buffer.from(payload);
    let offset = 0;
    while (offset < buf.byteLength) {
      const w = fs.writeSync(fd, buf, offset, buf.byteLength - offset);
      if (w <= 0) throw new HarnessError("INTEGRITY", "session authority write made no progress");
      offset += w;
    }
    fs.fsyncSync(fd);
    obs?.("file-fsync", path);
    fs.closeSync(fd);
    fd = undefined;
    paths.assertSingleLinkRegular(path);
    fs.renameSync(tmp, path);
    obs?.("rename", path);
    const dir = fs.openSync(
      parent,
      fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0) | paths.noFollow(),
    );
    try {
      fs.fsyncSync(dir);
      obs?.("directory-fsync", path);
    } finally {
      fs.closeSync(dir);
    }
  } catch (error) {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(tmp)) fs.rmSync(tmp);
    throw error;
  }
}

export function withSessionAuthorityLock<T>(repoRoot: string, dir: string, op: () => T): T {
  if (isInMemorySessionStoreEnabled()) {
    let res!: T,
      pri: unknown,
      hasPri = false,
      cln: unknown,
      hasCln = false;
    try {
      res = op();
    } catch (e) {
      hasPri = true;
      pri = e;
    }
    try {
      if (sessionLockCleanupFault.enabled) throw sessionLockCleanupFault.value;
    } catch (e) {
      hasCln = true;
      cln = e;
    }
    if (hasPri) throw pri;
    if (hasCln) throw cln;
    return res;
  }
  const root = paths.openVerifiedDirectory(repoRoot, false, "session repository root");
  let sess: { fd: number; stat: Stats } | undefined,
    rootLocked = false,
    sessLocked = false,
    pri: unknown,
    hasPri = false,
    cln: unknown,
    hasCln = false,
    res!: T;
  try {
    if (!tryExclusiveFlock(root.fd))
      throw new HarnessError("LOCK_TIMEOUT", "session repository lock is busy");
    rootLocked = true;
    paths.assertRealDirectory(dirname(dir), "session authority parent");
    sess = paths.openVerifiedDirectory(dir, true, "session authority directory");
    if (!tryExclusiveFlock(sess.fd))
      throw new HarnessError("LOCK_TIMEOUT", "session directory lock is busy");
    sessLocked = true;
    if (
      !paths.sameInode(root.stat, paths.assertRealDirectory(repoRoot, "session repository root")) ||
      !paths.sameInode(sess.stat, paths.assertRealDirectory(dir, "session authority directory"))
    ) {
      throw new HarnessError("INTEGRITY", "session authority changed while locked");
    }
    res = op();
  } catch (e) {
    hasPri = true;
    pri = e;
  }
  const run = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      if (!hasCln) {
        hasCln = true;
        cln = e;
      }
    }
  };
  run(() => {
    if (sessionLockCleanupFault.enabled) throw sessionLockCleanupFault.value;
  });
  run(() => {
    if (sess && sessLocked) releaseFlock(sess.fd);
    if (sess) fs.closeSync(sess.fd);
  });
  run(() => {
    if (rootLocked) releaseFlock(root.fd);
    fs.closeSync(root.fd);
  });
  if (hasPri) throw pri;
  if (hasCln) throw cln;
  return res;
}

export function snapshotSession(path: string): SessionSnapshot {
  const bytes = isInMemorySessionStoreEnabled()
    ? (getInMemorySessionData(path) ?? null)
    : fs.existsSync(path)
      ? secureReadSession(path)
      : null;
  return { path, bytes };
}

export function restoreSnapshotIfUnchanged(snapshot: SessionSnapshot, payload: string): void {
  if (isInMemorySessionStoreEnabled()) {
    if (getInMemorySessionData(snapshot.path) !== payload) return;
    if (snapshot.bytes === null) deleteInMemorySessionData(snapshot.path);
    else setInMemorySessionData(snapshot.path, snapshot.bytes);
    return;
  }
  if (!fs.existsSync(snapshot.path) || secureReadSession(snapshot.path) !== payload) return;
  if (snapshot.bytes === null) fs.unlinkSync(snapshot.path);
  else fs.writeFileSync(snapshot.path, snapshot.bytes, "utf8");
}
