import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  type Stats,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { HarnessError } from "../core/errors/index.ts";
import { releaseFlock } from "../platform/index.ts";
import type { StrictDefectLedgerEntry } from "./types.ts";
import {
  acquireExclusiveLock,
  activeDefectAuthorityPaths,
  activeDefectLockInodes,
  activeDefectLockPaths,
  activeDefectParents,
  activeDefectRootInodes,
  activeDefectRootPaths,
  activeDefectRoots,
  assertRealDirectory,
  assertRegularDefectLog,
  defectAuthorityRoot,
  openVerifiedDirectory,
  replaceDefectLogFileUnlocked,
  requiredNoFollowFlag,
  sameInode,
} from "./lock.ts";

export function strictLedgerIntegrity(message: string): HarnessError {
  return new HarnessError("INTEGRITY", message);
}

export function readStrictLedgerUnlocked(filePath: string): StrictDefectLedgerEntry[] {
  assertRegularDefectLog(filePath);
  if (!existsSync(filePath)) return [];
  let descriptor: number | undefined;
  try {
    const before = lstatSync(filePath);
    descriptor = openSync(filePath, constants.O_RDONLY | requiredNoFollowFlag());
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino
    ) {
      throw strictLedgerIntegrity(`defect ledger changed while opening: ${filePath}`);
    }
    const raw = readFileSync(descriptor, "utf8");
    const after = lstatSync(filePath);
    if (
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      !after.isFile() ||
      after.nlink !== 1
    ) {
      throw strictLedgerIntegrity(`defect ledger changed while reading: ${filePath}`);
    }
    const seen = new Set<string>();
    const entries: StrictDefectLedgerEntry[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        throw strictLedgerIntegrity(`defect ledger contains malformed JSON: ${filePath}`);
      }
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw strictLedgerIntegrity(`defect ledger contains a non-object record: ${filePath}`);
      }
      const id = (value as Record<string, unknown>).id;
      if (typeof id !== "string" || !id.trim()) {
        throw strictLedgerIntegrity(`defect ledger record requires a non-blank id: ${filePath}`);
      }
      if (seen.has(id)) {
        throw strictLedgerIntegrity(`defect ledger contains duplicate id '${id}': ${filePath}`);
      }
      seen.add(id);
      entries.push({
        id,
        value: value as Readonly<Record<string, unknown>>,
        line,
      });
    }
    return entries;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function serializedRawEntries(entries: readonly StrictDefectLedgerEntry[]): string {
  return entries.length === 0 ? "" : `${entries.map((entry) => entry.line).join("\n")}\n`;
}

export function hashLedger(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function withDefectLedgerTransaction<T>(
  filePaths: readonly string[],
  operation: () => T,
): T {
  const targets = [...new Set(filePaths.map((path) => resolve(path)))].sort();
  if (targets.length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "defect transaction needs a ledger");
  }
  const roots = [...new Set(targets.map(defectAuthorityRoot))].sort();
  const parents = [...new Set(targets.map((path) => dirname(path)))].sort();
  const parentAuthorities = new Map<string, string>();
  for (const target of targets) {
    parentAuthorities.set(resolve(dirname(target)), resolve(defectAuthorityRoot(target)));
  }
  const handles: Array<{ descriptor: number; locked: boolean }> = [];
  const openedRoots = new Map<string, Stats>();
  const activePaths = [...roots, ...parents];
  for (const path of activePaths) {
    if (activeDefectLockPaths.has(resolve(path)) || activeDefectRootPaths.has(resolve(path))) {
      throw new HarnessError(
        "LOCK_TIMEOUT",
        `defect ledger transaction is already active: ${path}`,
      );
    }
  }
  try {
    for (const root of roots) {
      const opened = openVerifiedDirectory(root, false);
      acquireExclusiveLock(opened.descriptor, root);
      handles.push({ descriptor: opened.descriptor, locked: true });
      openedRoots.set(resolve(root), opened.metadata);
      activeDefectRootPaths.add(resolve(root));
      activeDefectRootInodes.add(`${opened.metadata.dev}:${opened.metadata.ino}`);
      activeDefectRoots.set(resolve(root), opened.metadata);
      if (!sameInode(opened.metadata, assertRealDirectory(root, "defect authority root"))) {
        throw strictLedgerIntegrity(`defect authority root changed while locked: ${root}`);
      }
    }
    for (const parent of parents) {
      if (roots.includes(parent)) continue;
      const opened = openVerifiedDirectory(parent, true);
      acquireExclusiveLock(opened.descriptor, parent);
      handles.push({ descriptor: opened.descriptor, locked: true });
      activeDefectLockPaths.add(resolve(parent));
      activeDefectLockInodes.add(`${opened.metadata.dev}:${opened.metadata.ino}`);
      activeDefectParents.set(resolve(parent), opened.metadata);
      const authority = parentAuthorities.get(resolve(parent));
      if (!authority) throw strictLedgerIntegrity(`missing authority root for parent: ${parent}`);
      activeDefectAuthorityPaths.set(resolve(parent), authority);
      if (!sameInode(opened.metadata, assertRealDirectory(parent, "defect ledger parent"))) {
        throw strictLedgerIntegrity(`defect ledger parent changed while locked: ${parent}`);
      }
    }
    for (const parent of parents) {
      if (!roots.includes(parent)) continue;
      const authority = parentAuthorities.get(resolve(parent));
      if (!authority) throw strictLedgerIntegrity(`missing authority root for parent: ${parent}`);
      const metadata = openedRoots.get(resolve(parent));
      if (!metadata) throw strictLedgerIntegrity(`missing authority root metadata: ${parent}`);
      activeDefectLockPaths.add(resolve(parent));
      activeDefectParents.set(resolve(parent), metadata);
      activeDefectAuthorityPaths.set(resolve(parent), authority);
    }
    for (const target of targets) assertRegularDefectLog(target);
    return operation();
  } finally {
    let cleanup: unknown;
    for (const handle of handles.reverse()) {
      try {
        if (handle.locked) releaseFlock(handle.descriptor);
        closeSync(handle.descriptor);
      } catch (error) {
        cleanup ??= error;
      }
    }
    for (const parent of parents) {
      const parentPath = resolve(parent);
      const metadata = activeDefectParents.get(parentPath);
      activeDefectLockPaths.delete(parentPath);
      activeDefectParents.delete(parentPath);
      activeDefectAuthorityPaths.delete(parentPath);
      if (metadata) activeDefectLockInodes.delete(`${metadata.dev}:${metadata.ino}`);
    }
    for (const root of roots) {
      const rootPath = resolve(root);
      const metadata = activeDefectRoots.get(rootPath);
      activeDefectRootPaths.delete(rootPath);
      activeDefectRoots.delete(rootPath);
      if (metadata) activeDefectRootInodes.delete(`${metadata.dev}:${metadata.ino}`);
    }
    if (cleanup !== undefined) throw cleanup;
  }
}

export function appendDefectLedgerRecord(
  filePath: string,
  record: Readonly<Record<string, unknown>>,
): string {
  const id = record.id;
  if (typeof id !== "string" || !id.trim()) {
    throw strictLedgerIntegrity("defect ledger append requires a non-blank id");
  }
  return withDefectLedgerTransaction([filePath], () => {
    const entries = readStrictLedgerUnlocked(filePath);
    if (entries.some((entry) => entry.id === id)) {
      throw strictLedgerIntegrity(`defect ledger already contains id '${id}'`);
    }
    const next = [...entries, { id, value: record, line: JSON.stringify(record) }];
    replaceDefectLogFileUnlocked(filePath, serializedRawEntries(next));
    return resolve(filePath);
  });
}

export function pruneDefectLedgerRecords(
  filePath: string,
  remove: (entry: StrictDefectLedgerEntry) => boolean,
): void {
  withDefectLedgerTransaction([filePath], () => {
    const next = readStrictLedgerUnlocked(filePath).filter((entry) => !remove(entry));
    replaceDefectLogFileUnlocked(filePath, serializedRawEntries(next));
  });
}
