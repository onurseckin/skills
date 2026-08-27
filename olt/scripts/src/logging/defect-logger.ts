import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  type Stats,
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import {
  aggregateDefectEntries,
  computeDefectDiscriminator,
  parseAndDeduplicateDefectJsonl,
  serializeAggregatedDefectLog,
  toAggregatedDefect,
} from "../mind/defects/index.ts";
import type {
  AggregatedDefect,
  DefectRecordInput,
  LiveDeduplicationOptions,
} from "../mind/defects/types.ts";
import { atomicWriteBytes } from "../core/durable-write.ts";
import { HarnessError } from "../core/errors/harness-error.ts";
import type { DefectLogOptions, DefectLogResult } from "./types.ts";
import { resolveDefectsPath } from "../core/shared/paths.ts";
import { releaseFlock, tryExclusiveFlock } from "../platform/flock-ffi.ts";

interface DefectLogDependencies {
  readonly atomicWrite: typeof atomicWriteBytes;
  readonly readFile: (filePath: string, encoding: "utf-8") => string;
}

const defaultDefectLogDependencies: DefectLogDependencies = {
  atomicWrite: atomicWriteBytes,
  readFile: readFileSync,
};

let defectLogDependencies = defaultDefectLogDependencies;
const activeDefectLockPaths = new Set<string>();
const activeDefectLockInodes = new Set<string>();
const activeDefectRootPaths = new Set<string>();
const activeDefectRootInodes = new Set<string>();
const activeDefectParents = new Map<string, Pick<Stats, "dev" | "ino">>();
const activeDefectRoots = new Map<string, Pick<Stats, "dev" | "ino">>();
const activeDefectAuthorityPaths = new Map<string, string>();

function requiredNoFollowFlag(): number {
  const flag = constants.O_NOFOLLOW;
  if (!Number.isInteger(flag) || flag === 0) {
    throw new HarnessError("UNSUPPORTED_PLATFORM", "defect mutation locking requires O_NOFOLLOW");
  }
  return flag;
}

function delay(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function sameInode(left: Pick<Stats, "dev" | "ino">, right: Pick<Stats, "dev" | "ino">): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function assertRealDirectory(path: string, label: string): Stats {
  let metadata: Stats;
  try {
    metadata = lstatSync(path);
  } catch {
    throw new HarnessError("INTEGRITY", `${label} is unavailable: ${path}`);
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new HarnessError("PATH_SAFETY", `${label} must be a real directory: ${path}`);
  }
  return metadata;
}

function openVerifiedDirectory(
  path: string,
  create: boolean,
): { descriptor: number; metadata: Stats } {
  if (!existsSync(path)) {
    if (!create)
      throw new HarnessError("INTEGRITY", `defect lock directory is unavailable: ${path}`);
    mkdirSync(path, { recursive: true, mode: 0o700 });
  }
  const before = assertRealDirectory(path, "defect lock directory");
  let descriptor: number | undefined;
  try {
    descriptor = openSync(
      path,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | requiredNoFollowFlag(),
    );
    const opened = fstatSync(descriptor);
    const after = assertRealDirectory(path, "defect lock directory");
    if (!opened.isDirectory() || !sameInode(before, opened) || !sameInode(opened, after)) {
      throw new HarnessError("INTEGRITY", `defect lock directory changed while opening: ${path}`);
    }
    return { descriptor, metadata: opened };
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    throw error;
  }
}

function defectAuthorityRoot(filePath: string): string {
  const parent = dirname(filePath);
  if (basename(parent) === ".olt") return dirname(parent);
  let candidate = parent;
  while (!existsSync(candidate)) {
    const ancestor = dirname(candidate);
    if (ancestor === candidate) {
      throw new HarnessError("INTEGRITY", `defect authority root is unavailable: ${parent}`);
    }
    candidate = ancestor;
  }
  return candidate;
}

function acquireExclusiveLock(descriptor: number, label: string): void {
  const deadline = performance.now() + 10_000;
  while (!tryExclusiveFlock(descriptor)) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) {
      throw new HarnessError("LOCK_TIMEOUT", `timed out waiting for defect log lock: ${label}`);
    }
    delay(Math.min(10, remaining));
  }
}

function assertRegularDefectLog(filePath: string): void {
  if (!existsSync(filePath)) return;
  const metadata = lstatSync(filePath);
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1) {
    const reason = metadata.isDirectory() ? "EISDIR" : "not a regular file";
    throw new HarnessError("INTEGRITY", `failed to read defect log at '${filePath}': ${reason}`);
  }
}

export function withDefectLogMutationLock<T>(filePath: string, operation: () => T): T {
  const parent = dirname(filePath);
  const root = defectAuthorityRoot(filePath);
  const parentPath = resolve(parent);
  const rootPath = resolve(root);
  if (activeDefectLockPaths.has(parentPath) || activeDefectRootPaths.has(rootPath)) {
    throw new HarnessError(
      "LOCK_TIMEOUT",
      `defect log is already active in this process: ${filePath}`,
    );
  }

  let rootDescriptor: number | undefined;
  let rootAcquired = false;
  let rootInode: string | undefined;
  let parentDescriptor: number | undefined;
  let parentAcquired = false;
  let parentInode: string | undefined;
  let hasPrimary = false;
  let primary: unknown;
  let hasCleanup = false;
  let cleanupFailure: unknown;
  let result!: T;
  activeDefectLockPaths.add(parentPath);
  activeDefectRootPaths.add(rootPath);
  activeDefectAuthorityPaths.set(parentPath, rootPath);
  try {
    const openedRoot = openVerifiedDirectory(root, false);
    rootDescriptor = openedRoot.descriptor;
    rootInode = `${openedRoot.metadata.dev}:${openedRoot.metadata.ino}`;
    if (activeDefectRootInodes.has(rootInode)) {
      throw new HarnessError("LOCK_TIMEOUT", `defect authority root is already active: ${root}`);
    }
    activeDefectRootInodes.add(rootInode);
    activeDefectRoots.set(rootPath, openedRoot.metadata);
    acquireExclusiveLock(rootDescriptor, root);
    rootAcquired = true;
    if (!sameInode(openedRoot.metadata, assertRealDirectory(root, "defect authority root"))) {
      throw new HarnessError("INTEGRITY", `defect authority root changed while locked: ${root}`);
    }

    if (parentPath !== rootPath) {
      const openedParent = openVerifiedDirectory(parent, true);
      parentDescriptor = openedParent.descriptor;
      parentInode = `${openedParent.metadata.dev}:${openedParent.metadata.ino}`;
      if (activeDefectLockInodes.has(parentInode)) {
        throw new HarnessError("LOCK_TIMEOUT", `defect log parent is already active: ${parent}`);
      }
      activeDefectLockInodes.add(parentInode);
      activeDefectParents.set(parentPath, openedParent.metadata);
      acquireExclusiveLock(parentDescriptor, parent);
      parentAcquired = true;
      if (!sameInode(openedParent.metadata, assertRealDirectory(parent, "defect log parent"))) {
        throw new HarnessError("INTEGRITY", `defect log parent changed while locked: ${parent}`);
      }
    } else {
      activeDefectParents.set(parentPath, openedRoot.metadata);
    }

    assertRegularDefectLog(filePath);
    result = operation();
    if (!sameInode(openedRoot.metadata, assertRealDirectory(root, "defect authority root"))) {
      throw new HarnessError("INTEGRITY", `defect authority root changed after mutation: ${root}`);
    }
  } catch (error) {
    hasPrimary = true;
    primary = error;
  }

  for (const cleanup of [
    () => {
      if (parentDescriptor !== undefined && parentAcquired) releaseFlock(parentDescriptor);
    },
    () => {
      if (parentDescriptor !== undefined) closeSync(parentDescriptor);
    },
    () => {
      if (rootDescriptor !== undefined && rootAcquired) releaseFlock(rootDescriptor);
    },
    () => {
      if (rootDescriptor !== undefined) closeSync(rootDescriptor);
    },
  ]) {
    try {
      cleanup();
    } catch (error) {
      if (!hasCleanup) {
        hasCleanup = true;
        cleanupFailure = error;
      }
    }
  }
  activeDefectLockPaths.delete(parentPath);
  activeDefectRootPaths.delete(rootPath);
  activeDefectParents.delete(parentPath);
  activeDefectRoots.delete(rootPath);
  activeDefectAuthorityPaths.delete(parentPath);
  if (rootInode !== undefined) activeDefectRootInodes.delete(rootInode);
  if (parentInode !== undefined) activeDefectLockInodes.delete(parentInode);
  if (hasPrimary) throw primary;
  if (hasCleanup) throw cleanupFailure;
  return result;
}

function assertCurrentDefectMutationAuthority(filePath: string): void {
  const parentPath = resolve(dirname(filePath));
  const expectedParent = activeDefectParents.get(parentPath);
  if (
    expectedParent === undefined ||
    !sameInode(expectedParent, assertRealDirectory(parentPath, "defect log parent"))
  ) {
    throw new HarnessError("INTEGRITY", `defect log parent changed before write: ${parentPath}`);
  }
  const rootPath = activeDefectAuthorityPaths.get(parentPath);
  const expectedRoot = rootPath === undefined ? undefined : activeDefectRoots.get(rootPath);
  if (
    expectedRoot === undefined ||
    rootPath === undefined ||
    !sameInode(expectedRoot, assertRealDirectory(rootPath, "defect authority root"))
  ) {
    throw new HarnessError(
      "INTEGRITY",
      `defect authority root changed before write: ${rootPath ?? "unknown"}`,
    );
  }
}

export function setDefectLogDependenciesForTesting(
  overrides: Partial<DefectLogDependencies>,
): () => void {
  const previousDependencies = defectLogDependencies;
  defectLogDependencies = { ...defectLogDependencies, ...overrides };
  return () => {
    defectLogDependencies = previousDependencies;
  };
}

function readOwnDataString(error: unknown, property: string): string | null {
  if (error === null || (typeof error !== "object" && typeof error !== "function")) {
    return null;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, property);
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") {
      return null;
    }
    return descriptor.value;
  } catch {
    return null;
  }
}

function hasOwnFilesystemCode(error: unknown, code: string): boolean {
  try {
    return error instanceof Error && readOwnDataString(error, "code") === code;
  } catch {
    return false;
  }
}

function isTrustedIntegrityError(error: unknown): error is HarnessError {
  try {
    return error instanceof HarnessError && readOwnDataString(error, "code") === "INTEGRITY";
  } catch {
    return false;
  }
}

function formatSafeErrorCause(error: unknown): string {
  return readOwnDataString(error, "message") ?? "unknown error";
}

function throwDefectLogIntegrityError(operation: string, filePath: string, error: unknown): never {
  if (isTrustedIntegrityError(error)) {
    throw error;
  }
  throw new HarnessError(
    "INTEGRITY",
    `failed to ${operation} defect log at '${filePath}': ${formatSafeErrorCause(error)}`,
  );
}

export function resolveDefectLogPath(options: DefectLogOptions = {}): string | null {
  if (options.filePath) {
    return resolve(options.filePath);
  }
  if (options.runRoot) {
    return join(resolve(options.runRoot), "defects.jsonl");
  }
  if (options.targetDir) {
    return join(resolve(options.targetDir), "defects.jsonl");
  }
  return resolveDefectsPath(options.cwd);
}

export function readDefectLogFile(
  filePath: string,
  options: LiveDeduplicationOptions = {},
): AggregatedDefect[] {
  try {
    const content = defectLogDependencies.readFile(filePath, "utf-8");
    return parseAndDeduplicateDefectJsonl(content, options);
  } catch (error) {
    if (hasOwnFilesystemCode(error, "ENOENT")) {
      return [];
    }
    throwDefectLogIntegrityError("read", filePath, error);
  }
}

export function replaceDefectLogFileUnlocked(filePath: string, serialized: string): void {
  assertRegularDefectLog(filePath);
  assertCurrentDefectMutationAuthority(filePath);
  try {
    defectLogDependencies.atomicWrite(filePath, new TextEncoder().encode(serialized));
  } catch (error) {
    throwDefectLogIntegrityError("write", filePath, error);
  }
}

export function recordKeyedDefect(
  defect: DefectRecordInput,
  options: DefectLogOptions = {},
): DefectLogResult {
  const targetPath = resolveDefectLogPath(options);
  const deduplicate = options.deduplicate !== false;

  const keyOptsObj = options.keyOptions !== undefined ? { keyOptions: options.keyOptions } : {};

  if (!targetPath) {
    const entry = toAggregatedDefect(defect, keyOptsObj);
    return {
      recorded: entry,
      isNew: true,
      totalEntries: 1,
      filePath: "",
    };
  }

  const liveDedupOpts: LiveDeduplicationOptions = {
    ...(options.strategy !== undefined ? { strategy: options.strategy } : {}),
    ...(options.windowMs !== undefined ? { windowMs: options.windowMs } : {}),
    ...(options.maxOccurrencesTracked !== undefined
      ? { maxOccurrencesTracked: options.maxOccurrencesTracked }
      : {}),
    ...(options.keyOptions !== undefined ? { keyOptions: options.keyOptions } : {}),
  };

  return withDefectLogMutationLock(targetPath, () => {
    const existingEntries = readDefectLogFile(targetPath, liveDedupOpts);

    const key = computeDefectDiscriminator(defect, options.keyOptions);
    const existingIndex = existingEntries.findIndex((e) => e.dedup_key === key);

    let recorded: AggregatedDefect;
    let isNew = false;

    if (!deduplicate || existingIndex < 0) {
      recorded = toAggregatedDefect(defect, keyOptsObj);
      existingEntries.push(recorded);
      isNew = true;
    } else {
      const existing = existingEntries[existingIndex];
      if (existing) {
        recorded = aggregateDefectEntries(
          existing,
          defect,
          options.maxOccurrencesTracked !== undefined
            ? { maxOccurrences: options.maxOccurrencesTracked }
            : {},
        );
        existingEntries[existingIndex] = recorded;
      } else {
        recorded = toAggregatedDefect(defect, keyOptsObj);
        existingEntries.push(recorded);
        isNew = true;
      }
    }

    replaceDefectLogFileUnlocked(targetPath, serializeAggregatedDefectLog(existingEntries));
    return {
      recorded,
      isNew,
      totalEntries: existingEntries.length,
      filePath: targetPath,
    };
  });
}

export function compactDefectLogFile(
  filePath: string,
  options: LiveDeduplicationOptions = {},
): { totalBefore: number; totalAfter: number; filePath: string } {
  return withDefectLogMutationLock(filePath, () => {
    if (!existsSync(filePath)) {
      return { totalBefore: 0, totalAfter: 0, filePath };
    }
    const rawContent = defectLogDependencies.readFile(filePath, "utf-8");
    const rawLines = rawContent
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const totalBefore = rawLines.length;
    const aggregated = parseAndDeduplicateDefectJsonl(rawContent, options);
    const totalAfter = aggregated.length;
    replaceDefectLogFileUnlocked(filePath, serializeAggregatedDefectLog(aggregated));
    return { totalBefore, totalAfter, filePath };
  });
}

/** A raw JSONL entry used by the transaction layer.  `line` is deliberately
 * retained verbatim so a mutation never normalizes an older schema. */
export interface StrictDefectLedgerEntry {
  readonly id: string;
  readonly value: Readonly<Record<string, unknown>>;
  readonly line: string;
}

interface DefectPromotionJournal {
  readonly version: 1;
  readonly state: "PREPARED" | "COMMITTED";
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly ids: readonly string[];
  readonly sourceHash: string;
  readonly targetHash: string;
}

export type DefectPromotionPersistenceStage =
  | "PREPARED"
  | "TARGET_DURABLE"
  | "SOURCE_DURABLE"
  | "COMMITTED";

let defectPromotionPersistenceHook: ((stage: DefectPromotionPersistenceStage) => void) | undefined;

/** @internal deterministic crash seam for transaction recovery tests. */
export function __setDefectPromotionPersistenceTestHook(
  hook: ((stage: DefectPromotionPersistenceStage) => void) | undefined,
): void {
  defectPromotionPersistenceHook = hook;
}

function observeDefectPromotionStage(stage: DefectPromotionPersistenceStage): void {
  defectPromotionPersistenceHook?.(stage);
}

function strictLedgerIntegrity(message: string): HarnessError {
  return new HarnessError("INTEGRITY", message);
}

function readStrictLedgerUnlocked(filePath: string): StrictDefectLedgerEntry[] {
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
    )
      throw strictLedgerIntegrity(`defect ledger changed while reading: ${filePath}`);
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
      if (typeof value !== "object" || value === null || Array.isArray(value))
        throw strictLedgerIntegrity(`defect ledger contains a non-object record: ${filePath}`);
      const id = (value as Record<string, unknown>).id;
      if (typeof id !== "string" || !id.trim())
        throw strictLedgerIntegrity(`defect ledger record requires a non-blank id: ${filePath}`);
      if (seen.has(id))
        throw strictLedgerIntegrity(`defect ledger contains duplicate id '${id}': ${filePath}`);
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

function serializedRawEntries(entries: readonly StrictDefectLedgerEntry[]): string {
  return entries.length === 0 ? "" : `${entries.map((entry) => entry.line).join("\n")}\n`;
}

function hashLedger(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Performs a coordinated ledger mutation.  All authority roots are acquired
 * before the lexically-sorted set of distinct parents; this eliminates the
 * lock-order inversion that previously lost append/promotion updates.
 */
export function withDefectLedgerTransaction<T>(
  filePaths: readonly string[],
  operation: () => T,
): T {
  const targets = [...new Set(filePaths.map((path) => resolve(path)))].sort();
  if (targets.length === 0)
    throw new HarnessError("INVALID_ARGUMENT", "defect transaction needs a ledger");
  const roots = [...new Set(targets.map(defectAuthorityRoot))].sort();
  const parents = [...new Set(targets.map((path) => dirname(path)))].sort();
  const parentAuthorities = new Map<string, string>();
  for (const target of targets)
    parentAuthorities.set(resolve(dirname(target)), resolve(defectAuthorityRoot(target)));
  const handles: Array<{ descriptor: number; locked: boolean }> = [];
  const openedRoots = new Map<string, Stats>();
  const activePaths = [...roots, ...parents];
  for (const path of activePaths) {
    if (activeDefectLockPaths.has(resolve(path)) || activeDefectRootPaths.has(resolve(path)))
      throw new HarnessError(
        "LOCK_TIMEOUT",
        `defect ledger transaction is already active: ${path}`,
      );
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
      if (!sameInode(opened.metadata, assertRealDirectory(root, "defect authority root")))
        throw strictLedgerIntegrity(`defect authority root changed while locked: ${root}`);
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
      if (!sameInode(opened.metadata, assertRealDirectory(parent, "defect ledger parent")))
        throw strictLedgerIntegrity(`defect ledger parent changed while locked: ${parent}`);
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
  if (typeof id !== "string" || !id.trim())
    throw strictLedgerIntegrity("defect ledger append requires a non-blank id");
  return withDefectLedgerTransaction([filePath], () => {
    const entries = readStrictLedgerUnlocked(filePath);
    if (entries.some((entry) => entry.id === id))
      throw strictLedgerIntegrity(`defect ledger already contains id '${id}'`);
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

function promotionJournalPath(targetPath: string): string {
  return join(dirname(targetPath), `.${basename(targetPath)}.defect-promotion.journal.json`);
}

function writePromotionJournal(path: string, journal: DefectPromotionJournal): void {
  atomicWriteBytes(path, new TextEncoder().encode(`${JSON.stringify(journal)}\n`), { mode: 0o600 });
}

function readPromotionJournal(path: string): DefectPromotionJournal | undefined {
  if (!existsSync(path)) return undefined;
  assertRegularDefectLog(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw strictLedgerIntegrity(`defect promotion journal is malformed: ${path}`);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    (parsed as Record<string, unknown>).version !== 1 ||
    ((parsed as Record<string, unknown>).state !== "PREPARED" &&
      (parsed as Record<string, unknown>).state !== "COMMITTED") ||
    !Array.isArray((parsed as Record<string, unknown>).ids)
  )
    throw strictLedgerIntegrity(`defect promotion journal is invalid: ${path}`);
  return parsed as DefectPromotionJournal;
}

function verifyPromotionJournal(
  journal: DefectPromotionJournal,
  source: readonly StrictDefectLedgerEntry[],
  target: readonly StrictDefectLedgerEntry[],
): void {
  if (
    !/^[a-f0-9]{64}$/.test(journal.sourceHash) ||
    !/^[a-f0-9]{64}$/.test(journal.targetHash) ||
    journal.ids.some((id) => typeof id !== "string" || !id.trim()) ||
    new Set(journal.ids).size !== journal.ids.length
  )
    throw strictLedgerIntegrity("defect promotion journal hashes or ids are invalid");
  const sourceIds = new Set(source.map((entry) => entry.id));
  const targetIds = new Set(target.map((entry) => entry.id));
  const targetContainsAll = journal.ids.every((id) => targetIds.has(id));
  const sourceContainsAll = journal.ids.every((id) => sourceIds.has(id));
  if (!targetContainsAll && !sourceContainsAll)
    throw strictLedgerIntegrity("defect promotion journal records are missing from both ledgers");
}

/** Deterministically finishes an interrupted promotion without duplicating IDs. */
export function recoverDefectPromotion(sourcePath: string, targetPath: string): void {
  const journalPath = promotionJournalPath(targetPath);
  withDefectLedgerTransaction([sourcePath, targetPath, journalPath], () => {
    const journal = readPromotionJournal(journalPath);
    if (!journal) return;
    if (
      resolve(journal.sourcePath) !== resolve(sourcePath) ||
      resolve(journal.targetPath) !== resolve(targetPath)
    )
      throw strictLedgerIntegrity(`defect promotion journal targets do not match: ${journalPath}`);
    const ids = new Set(journal.ids);
    const source = readStrictLedgerUnlocked(sourcePath);
    const target = readStrictLedgerUnlocked(targetPath);
    verifyPromotionJournal(journal, source, target);
    const targetIds = new Set(target.map((entry) => entry.id));
    if ([...ids].some((id) => !targetIds.has(id))) {
      // PREPARED means no durable target proof; leave the source untouched.
      if (journal.state === "COMMITTED")
        throw strictLedgerIntegrity(
          `committed promotion journal is missing target records: ${journalPath}`,
        );
      unlinkSync(journalPath);
      return;
    }
    const remaining = source.filter((entry) => !ids.has(entry.id));
    replaceDefectLogFileUnlocked(sourcePath, serializedRawEntries(remaining));
    if (journal.state === "PREPARED") {
      writePromotionJournal(journalPath, { ...journal, state: "COMMITTED" });
    }
    unlinkSync(journalPath);
    const directoryDescriptor = openSync(
      dirname(targetPath),
      constants.O_RDONLY | constants.O_DIRECTORY | requiredNoFollowFlag(),
    );
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  });
}

export function promoteDefectLedgerRecords(
  sourcePath: string,
  targetPath: string,
  ids: readonly string[],
): void {
  if (resolve(sourcePath) === resolve(targetPath))
    throw strictLedgerIntegrity("active and completed defect ledgers must be distinct");
  const selected = [...new Set(ids)];
  if (selected.length === 0) return;
  const journalPath = promotionJournalPath(targetPath);
  if (existsSync(journalPath)) recoverDefectPromotion(sourcePath, targetPath);
  withDefectLedgerTransaction([sourcePath, targetPath, journalPath], () => {
    if (readPromotionJournal(journalPath))
      throw strictLedgerIntegrity(
        `defect promotion journal appeared during mutation: ${journalPath}`,
      );
    const source = readStrictLedgerUnlocked(sourcePath);
    const target = readStrictLedgerUnlocked(targetPath);
    const sourceById = new Map(source.map((entry) => [entry.id, entry]));
    const missing = selected.find((id) => !sourceById.has(id));
    if (missing !== undefined) throw strictLedgerIntegrity(`active defect '${missing}' is absent`);
    const targetById = new Map(target.map((entry) => [entry.id, entry]));
    const additions = selected.map((id) => sourceById.get(id)!);
    // A target-only partial commit is a valid recovery state: identity, not
    // re-serialization, establishes exactly-once promotion.  The source is
    // pruned below while the already durable target record is left untouched.
    const merged = [...target, ...additions.filter((entry) => !targetById.has(entry.id))];
    const journal: DefectPromotionJournal = {
      version: 1,
      state: "PREPARED",
      sourcePath: resolve(sourcePath),
      targetPath: resolve(targetPath),
      ids: selected,
      sourceHash: hashLedger(serializedRawEntries(source)),
      targetHash: hashLedger(serializedRawEntries(merged)),
    };
    writePromotionJournal(journalPath, journal);
    observeDefectPromotionStage("PREPARED");
    replaceDefectLogFileUnlocked(targetPath, serializedRawEntries(merged));
    observeDefectPromotionStage("TARGET_DURABLE");
    replaceDefectLogFileUnlocked(
      sourcePath,
      serializedRawEntries(source.filter((entry) => !selected.includes(entry.id))),
    );
    observeDefectPromotionStage("SOURCE_DURABLE");
    writePromotionJournal(journalPath, { ...journal, state: "COMMITTED" });
    observeDefectPromotionStage("COMMITTED");
    unlinkSync(journalPath);
  });
}
