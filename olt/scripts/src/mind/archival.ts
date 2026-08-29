import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { HarnessError } from "../core/errors/index.ts";
import { isTestEnvironment, resolveCapsulesDir, resolveScratchDir } from "../core/shared/paths.ts";
import { safeCpSync, safeRenameSync, safeRmSync } from "../core/shared/safe-fs.ts";
import { releaseFlock, tryExclusiveFlock } from "../platform/index.ts";
import type { CandidateRecord } from "./gates.ts";
import type { ObjectiveRecord } from "./rounds.ts";

export type ArchivedItemType = "objective" | "candidate" | "task";

export const ARCHIVED_ITEM_TYPES: readonly ArchivedItemType[] = ["objective", "candidate", "task"];

export function isArchivedItemType(value: unknown): value is ArchivedItemType {
  return typeof value === "string" && (ARCHIVED_ITEM_TYPES as readonly string[]).includes(value);
}

export interface ArchivedObjectiveRecord {
  readonly id: string;
  readonly type: ArchivedItemType;
  readonly statement: string;
  readonly generation: number;
  readonly completed_at: string;
  readonly result: string;
  readonly candidate_id?: string | null | undefined;
  readonly objective_id?: string | null | undefined;
  readonly task_id?: string | null | undefined;
  readonly write_scope?: readonly string[] | undefined;
  readonly charter_goals?: readonly string[] | undefined;
  readonly details?: Readonly<Record<string, unknown>> | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export const BOILERPLATE_CAPSULE_SUBDIRECTORIES: readonly string[] = [
  "blobs",
  "commands",
  "evidence",
  "packets",
  "planning",
  "reports",
  "quarantine",
  "screenshots",
  "summary",
  "runtime",
];

export interface PruneBoilerplateOptions {
  readonly dryRun?: boolean | undefined;
  readonly subdirectories?: readonly string[] | undefined;
}

export interface PruneBoilerplateResult {
  readonly capsulePath: string;
  readonly prunedDirectories: readonly string[];
  readonly preservedDirectories: readonly string[];
}

export interface ArchiveCapsuleOptions {
  readonly targetArchiveDir?: string | undefined;
  readonly pruneBoilerplate?: boolean | undefined;
  readonly overwrite?: boolean | undefined;
  readonly dryRun?: boolean | undefined;
  readonly allowGitRepositoryDeletion?: boolean | undefined;
}

export interface ArchiveCapsuleResult {
  readonly sourcePath: string;
  readonly archivedPath: string;
  readonly runId: string;
  readonly prunedDirectories: readonly string[];
}

export interface ConsolidateCapsulesOptions {
  readonly activeRunIds?: readonly string[] | undefined;
  readonly currentGeneration?: number | undefined;
  readonly retentionGenerations?: number | undefined;
  readonly targetArchiveDir?: string | undefined;
  readonly pruneBoilerplate?: boolean | undefined;
  readonly dryRun?: boolean | undefined;
}

export interface ConsolidateCapsulesResult {
  readonly capsulesDir: string;
  readonly activeCapsules: readonly string[];
  readonly archivedCapsules: readonly string[];
  readonly prunedSubdirectoriesCount: number;
  readonly archiveDir: string;
}

export interface PruneAndArchiveOptions {
  readonly sourceState: Record<string, unknown>;
  readonly sourceGeneration: number;
  readonly retentionGenerations?: number | undefined;
  readonly capsulesDir?: string | undefined;
  readonly sourceRunRoot?: string | undefined;
  readonly targetRunRoot?: string | undefined;
  readonly customArchivalPath?: string | undefined;
  readonly nowIso?: string | undefined;
  readonly consolidateCapsulesOnDisk?: boolean | undefined;
  readonly pruneBoilerplateOnDisk?: boolean | undefined;
}

export interface PruneAndArchiveResult {
  readonly archivedRecords: readonly ArchivedObjectiveRecord[];
  readonly carriedCandidates: readonly CandidateRecord[];
  readonly carriedObjectives: readonly ObjectiveRecord[];
  readonly carriedTasks: readonly Record<string, unknown>[];
  readonly prunedCount: number;
  readonly archivedCount: number;
  readonly archivalPath: string;
  readonly consolidatedCapsules?: ConsolidateCapsulesResult | undefined;
  readonly prunedBoilerplateDirectories?: readonly string[] | undefined;
}

export const DEFAULT_ARCHIVED_OBJECTIVES_FILE = ".olt/capsules/ARCHIVED_OBJECTIVES.jsonl";

type ArchivedObjectivesPersistenceStage =
  | "before_write"
  | "before_file_fsync"
  | "before_rename"
  | "after_rename"
  | "before_directory_fsync";
let archivedObjectivesPersistenceTestHook:
  | ((stage: ArchivedObjectivesPersistenceStage) => void)
  | undefined;

/** @internal deterministic persistence seam for the unit suite. */
export function __setArchivedObjectivesPersistenceTestHook(
  hook: ((stage: ArchivedObjectivesPersistenceStage) => void) | undefined,
): void {
  archivedObjectivesPersistenceTestHook = hook;
}

function invokeArchivedObjectivesPersistenceHook(stage: ArchivedObjectivesPersistenceStage): void {
  archivedObjectivesPersistenceTestHook?.(stage);
}

function hasOwnErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && Object.getOwnPropertyDescriptor(error, "code")?.value === code;
}

function noFollowFlag(): number {
  if (typeof constants.O_NOFOLLOW !== "number") {
    throw new HarnessError(
      "UNSUPPORTED_PLATFORM",
      "archived objectives ledger requires O_NOFOLLOW protection",
    );
  }
  return constants.O_NOFOLLOW;
}

/**
 * Resolves the canonical path to the archived objectives ledger.
 */
export function resolveCanonicalArchivedObjectivesPath(
  customRoot?: string,
  _useTodo = false,
): string {
  return require("path").join(customRoot || process.cwd(), ".olt", "archived-objectives.jsonl");
}

/**
 * Resolves the path to the archived objectives ledger, supporting canonical, todo, and legacy locations.
 */
export function resolveArchivedObjectivesPath(capsulesDir?: string, customPath?: string): string {
  if (customPath && customPath.trim()) return resolve(customPath.trim());
  if (capsulesDir && capsulesDir.trim()) {
    return join(resolve(capsulesDir.trim()), "ARCHIVED_OBJECTIVES.jsonl");
  }
  if (isTestEnvironment()) {
    return join(resolveScratchDir(), "ARCHIVED_OBJECTIVES.jsonl");
  }
  return join(resolveCapsulesDir(), "ARCHIVED_OBJECTIVES.jsonl");
}

/**
 * Migrates legacy archived objectives files to the canonical .capsules/mind/queue/ layout.
 */

/**
 * Validates and normalizes an unknown object into an ArchivedObjectiveRecord.
 */
export function validateArchivedObjectiveRecord(raw: unknown): ArchivedObjectiveRecord {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new HarnessError("INVALID_ARGUMENT", "ArchivedObjectiveRecord must be an object");
  }

  const r = raw as Record<string, unknown>;
  const id = typeof r["id"] === "string" ? r["id"].trim() : "";
  if (!id) {
    throw new HarnessError("INVALID_ARGUMENT", "ArchivedObjectiveRecord requires non-empty id");
  }

  const valueString = (key: string): string | undefined =>
    typeof r[key] === "string" && r[key].trim() ? r[key].trim() : undefined;
  const isLegacyV1 = r["schema_version"] === 1;
  let type: ArchivedItemType;
  let statement: string;
  let generation: number;
  let completedAt: string;
  let result: string;

  if (isLegacyV1) {
    const legacyType = r["type"];
    type = isArchivedItemType(legacyType) ? legacyType : "objective";
    statement = valueString("title") ?? valueString("statement") ?? "";
    generation =
      typeof r["generation_id"] === "number" && Number.isFinite(r["generation_id"])
        ? (r["generation_id"] as number)
        : typeof r["generation"] === "number" && Number.isFinite(r["generation"])
          ? (r["generation"] as number)
          : Number.NaN;
    completedAt =
      valueString("closed_at") ?? valueString("decided_at") ?? valueString("completed_at") ?? "";
    result = valueString("status") ?? valueString("result") ?? "";
  } else {
    if (r["schema_version"] !== undefined && r["schema_version"] !== 2) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "ArchivedObjectiveRecord has unsupported schema_version",
      );
    }
    if (!isArchivedItemType(r["type"])) {
      throw new HarnessError("INVALID_ARGUMENT", "ArchivedObjectiveRecord requires a valid type");
    }
    type = r["type"];
    statement = valueString("statement") ?? "";
    generation =
      typeof r["generation"] === "number" && Number.isFinite(r["generation"])
        ? (r["generation"] as number)
        : Number.NaN;
    completedAt = valueString("completed_at") ?? "";
    result = valueString("result") ?? "";
  }
  if (!statement || !Number.isFinite(generation) || !completedAt || !result) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      isLegacyV1
        ? "legacy ArchivedObjectiveRecord v1 is missing a required explicit legacy field"
        : "ArchivedObjectiveRecord is missing a required current field",
    );
  }

  const candidateId =
    typeof r["candidate_id"] === "string"
      ? r["candidate_id"].trim()
      : r["candidate_id"] === null
        ? null
        : undefined;

  const objectiveId =
    typeof r["objective_id"] === "string"
      ? r["objective_id"].trim()
      : r["objective_id"] === null
        ? null
        : undefined;

  const taskId =
    typeof r["task_id"] === "string"
      ? r["task_id"].trim()
      : r["task_id"] === null
        ? null
        : undefined;

  const writeScope = Array.isArray(r["write_scope"])
    ? (r["write_scope"] as readonly string[])
    : undefined;

  const charterGoals = Array.isArray(r["charter_goals"])
    ? (r["charter_goals"] as readonly string[])
    : isLegacyV1 && Array.isArray(r["charter_goal_ids"])
      ? (r["charter_goal_ids"] as readonly string[])
      : undefined;

  const details =
    typeof r["details"] === "object" && r["details"] !== null && !Array.isArray(r["details"])
      ? (r["details"] as Readonly<Record<string, unknown>>)
      : undefined;

  const metadata =
    typeof r["metadata"] === "object" && r["metadata"] !== null && !Array.isArray(r["metadata"])
      ? (r["metadata"] as Readonly<Record<string, unknown>>)
      : undefined;

  return {
    id,
    type,
    statement,
    generation,
    completed_at: completedAt,
    result,
    ...(candidateId !== undefined ? { candidate_id: candidateId } : {}),
    ...(objectiveId !== undefined ? { objective_id: objectiveId } : {}),
    ...(taskId !== undefined ? { task_id: taskId } : {}),
    ...(writeScope !== undefined ? { write_scope: writeScope } : {}),
    ...(charterGoals !== undefined ? { charter_goals: charterGoals } : {}),
    ...(details !== undefined ? { details } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

/**
 * Reads and parses all records from ARCHIVED_OBJECTIVES.jsonl.
 */
export function readArchivedObjectives(customPath?: string): ArchivedObjectiveRecord[] {
  const filePath = resolveArchivedObjectivesPath(undefined, customPath);
  return parseArchivedObjectives(readArchivedObjectivesFile(filePath).raw);
}

interface ArchivedObjectivesSnapshot {
  readonly raw: string;
  readonly identity?: { readonly dev: number; readonly ino: number } | undefined;
}

function readArchivedObjectivesFile(filePath: string): ArchivedObjectivesSnapshot {
  let descriptor: number | undefined;
  try {
    const before = lstatSync(filePath);
    if (!before.isFile() || before.nlink !== 1) {
      throw new HarnessError(
        "INTEGRITY",
        "archived objectives ledger must be a single-link regular file",
      );
    }
    descriptor = openSync(filePath, constants.O_RDONLY | noFollowFlag());
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino
    ) {
      throw new HarnessError("INTEGRITY", "archived objectives ledger changed while being opened");
    }
    const raw = readFileSync(descriptor, "utf8");
    const after = lstatSync(filePath);
    if (
      !after.isFile() ||
      after.nlink !== 1 ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino
    ) {
      throw new HarnessError("INTEGRITY", "archived objectives ledger changed while being read");
    }
    return { raw, identity: { dev: opened.dev, ino: opened.ino } };
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) return { raw: "" };
    if (error instanceof HarnessError) throw error;
    throw new HarnessError(
      "INTEGRITY",
      `could not securely read archived objectives ledger: ${filePath}`,
    );
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function parseArchivedObjectives(raw: string): ArchivedObjectiveRecord[] {
  const items: ArchivedObjectiveRecord[] = [];
  const ids = new Set<string>();

  for (const [index, line] of raw.split("\n").entries()) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      const validated = validateArchivedObjectiveRecord(parsed);
      if (ids.has(validated.id)) {
        throw new HarnessError(
          "INTEGRITY",
          `archived objectives ledger line ${index + 1} duplicates id '${validated.id}'`,
        );
      }
      ids.add(validated.id);
      items.push(validated);
    } catch (error) {
      if (error instanceof HarnessError) throw error;
      throw new HarnessError(
        "INTEGRITY",
        `archived objectives ledger line ${index + 1} is malformed`,
      );
    }
  }

  return items;
}

function assertUniqueArchivedObjectives(
  items: readonly ArchivedObjectiveRecord[],
): ArchivedObjectiveRecord[] {
  const canonical: ArchivedObjectiveRecord[] = [];
  const ids = new Set<string>();
  for (const item of items) {
    const validated = validateArchivedObjectiveRecord(item);
    if (ids.has(validated.id)) {
      throw new HarnessError(
        "INTEGRITY",
        `archived objectives ledger duplicates id '${validated.id}'`,
      );
    }
    ids.add(validated.id);
    canonical.push(validated);
  }
  return canonical;
}

function acquireArchivedObjectivesFlock(descriptor: number, label: string): void {
  const sleep = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; attempt < 200; attempt++) {
    if (tryExclusiveFlock(descriptor)) return;
    Atomics.wait(sleep, 0, 0, 5);
  }
  throw new HarnessError("LOCK_TIMEOUT", `${label} is already locked`);
}

function assertStableArchivedObjectivesDirectory(
  path: string,
  descriptor: number,
  label: string,
): void {
  const pathStat = lstatSync(path);
  const opened = fstatSync(descriptor);
  if (
    !pathStat.isDirectory() ||
    !opened.isDirectory() ||
    pathStat.dev !== opened.dev ||
    pathStat.ino !== opened.ino
  ) {
    throw new HarnessError("INTEGRITY", `${label} directory changed while being opened`);
  }
}

interface StableArchivedObjectivesDirectoryChain {
  readonly paths: readonly string[];
  readonly descriptors: readonly number[];
}

/** Opens every absolute path component with O_DIRECTORY|O_NOFOLLOW and revalidates it by inode. */
function openStableArchivedObjectivesDirectoryChain(
  directory: string,
  label: string,
): StableArchivedObjectivesDirectoryChain {
  const paths: string[] = [];
  const descriptors: number[] = [];
  try {
    let current = "/";
    paths.push(current);
    for (const component of resolve(directory).split("/").filter(Boolean)) {
      current = join(current, component);
      paths.push(current);
    }
    for (const path of paths) {
      const before = lstatSync(path);
      if (!before.isDirectory()) {
        throw new HarnessError(
          "PATH_SAFETY",
          `${label} path component is not a directory: ${path}`,
        );
      }
      const descriptor = openSync(
        path,
        constants.O_RDONLY | constants.O_DIRECTORY | noFollowFlag(),
      );
      descriptors.push(descriptor);
      assertStableArchivedObjectivesDirectory(path, descriptor, label);
      for (let index = 0; index < descriptors.length; index++) {
        assertStableArchivedObjectivesDirectory(paths[index]!, descriptors[index]!, label);
      }
    }
    return { paths, descriptors };
  } catch (error) {
    for (const descriptor of descriptors.reverse()) {
      try {
        closeSync(descriptor);
      } catch {}
    }
    if (error instanceof HarnessError) throw error;
    throw new HarnessError("PATH_SAFETY", `${label} cannot be securely traversed`);
  }
}

function assertStableArchivedObjectivesDirectoryChain(
  chain: StableArchivedObjectivesDirectoryChain,
  label: string,
): void {
  for (let index = 0; index < chain.descriptors.length; index++) {
    assertStableArchivedObjectivesDirectory(chain.paths[index]!, chain.descriptors[index]!, label);
  }
}

function closeStableArchivedObjectivesDirectoryChain(
  chain: StableArchivedObjectivesDirectoryChain | undefined,
): void {
  if (!chain) return;
  let cleanup: unknown;
  for (const descriptor of [...chain.descriptors].reverse()) {
    try {
      closeSync(descriptor);
    } catch (error) {
      cleanup ??= error;
    }
  }
  if (cleanup !== undefined) throw cleanup;
}

function withArchivedObjectivesTransaction<T>(
  customPath: string | undefined,
  mutation: (items: readonly ArchivedObjectiveRecord[]) => {
    readonly items: readonly ArchivedObjectiveRecord[];
    readonly result: T;
  },
): T {
  const filePath = resolveArchivedObjectivesPath(undefined, customPath);
  const parent = dirname(filePath);
  const root = dirname(parent);
  let rootChain: StableArchivedObjectivesDirectoryChain | undefined;
  let parentChain: StableArchivedObjectivesDirectoryChain | undefined;
  let rootLocked = false;
  let parentLocked = false;
  let result!: T;
  let primary: unknown;
  try {
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true, mode: 0o700 });
    rootChain = openStableArchivedObjectivesDirectoryChain(root, "archived objectives root");
    const rootFd = rootChain.descriptors.at(-1)!;
    acquireArchivedObjectivesFlock(rootFd, "archived objectives root");
    rootLocked = true;
    assertStableArchivedObjectivesDirectoryChain(rootChain, "archived objectives root");
    parentChain = openStableArchivedObjectivesDirectoryChain(parent, "archived objectives parent");
    const parentFd = parentChain.descriptors.at(-1)!;
    acquireArchivedObjectivesFlock(parentFd, "archived objectives parent");
    parentLocked = true;
    assertStableArchivedObjectivesDirectoryChain(rootChain, "archived objectives root");
    assertStableArchivedObjectivesDirectoryChain(parentChain, "archived objectives parent");
    const snapshot = readArchivedObjectivesFile(filePath);
    const next = mutation(parseArchivedObjectives(snapshot.raw));
    atomicWriteArchivedObjectives(filePath, next.items, snapshot.identity);
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
  if (parentLocked && parentChain) tryCleanup(() => releaseFlock(parentChain!.descriptors.at(-1)!));
  if (rootLocked && rootChain) tryCleanup(() => releaseFlock(rootChain!.descriptors.at(-1)!));
  tryCleanup(() => closeStableArchivedObjectivesDirectoryChain(parentChain));
  tryCleanup(() => closeStableArchivedObjectivesDirectoryChain(rootChain));
  if (primary !== undefined) throw primary;
  if (cleanup !== undefined) throw cleanup;
  return result;
}

function atomicWriteArchivedObjectives(
  filePath: string,
  items: readonly ArchivedObjectiveRecord[],
  expectedPrevious: { readonly dev: number; readonly ino: number } | undefined,
): void {
  const canonical = assertUniqueArchivedObjectives(items);
  const raw =
    canonical.map((item) => JSON.stringify(item)).join("\n") + (canonical.length ? "\n" : "");
  const parent = dirname(filePath);
  const temporary = join(
    parent,
    `.archived-objectives.${process.pid}.${randomBytes(12).toString("hex")}.tmp`,
  );
  let tempFd: number | undefined;
  let parentChain: StableArchivedObjectivesDirectoryChain | undefined;
  let renamed = false;
  try {
    tempFd = openSync(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag(),
      0o600,
    );
    const bytes = Buffer.from(raw, "utf8");
    for (let offset = 0; offset < bytes.length;) {
      invokeArchivedObjectivesPersistenceHook("before_write");
      const written = writeSync(tempFd, bytes, offset, bytes.length - offset);
      if (written <= 0)
        throw new HarnessError("INTEGRITY", "could not write archived objectives ledger");
      offset += written;
    }
    invokeArchivedObjectivesPersistenceHook("before_file_fsync");
    fsyncSync(tempFd);
    closeSync(tempFd);
    tempFd = undefined;
    try {
      const current = lstatSync(filePath);
      if (
        !expectedPrevious ||
        !current.isFile() ||
        current.nlink !== 1 ||
        current.dev !== expectedPrevious.dev ||
        current.ino !== expectedPrevious.ino
      ) {
        throw new HarnessError(
          "INTEGRITY",
          "archived objectives ledger changed before replacement",
        );
      }
    } catch (error) {
      if (!(expectedPrevious === undefined && hasOwnErrorCode(error, "ENOENT"))) throw error;
    }
    invokeArchivedObjectivesPersistenceHook("before_rename");
    parentChain = openStableArchivedObjectivesDirectoryChain(parent, "archived objectives parent");
    renameSync(temporary, filePath);
    renamed = true;
    invokeArchivedObjectivesPersistenceHook("after_rename");
    assertStableArchivedObjectivesDirectoryChain(parentChain, "archived objectives parent");
    invokeArchivedObjectivesPersistenceHook("before_directory_fsync");
    fsyncSync(parentChain.descriptors.at(-1)!);
  } catch (error) {
    if (renamed) {
      throw new HarnessError(
        "INTEGRITY",
        "archived objectives ledger mutation outcome is uncertain and possibly committed after rename",
      );
    }
    throw error;
  } finally {
    if (tempFd !== undefined) closeSync(tempFd);
    closeStableArchivedObjectivesDirectoryChain(parentChain);
    if (!renamed) {
      try {
        unlinkSync(temporary);
      } catch (error) {
        if (!hasOwnErrorCode(error, "ENOENT")) throw error;
      }
    }
  }
}

/**
 * Writes records atomically to ARCHIVED_OBJECTIVES.jsonl.
 */
export function writeArchivedObjectives(
  items: readonly ArchivedObjectiveRecord[],
  customPath?: string,
): void {
  withArchivedObjectivesTransaction(customPath, () => ({ items, result: undefined }));
}

/**
 * Appends or updates archived objective records in ARCHIVED_OBJECTIVES.jsonl.
 */
export function appendArchivedObjectives(
  records: readonly ArchivedObjectiveRecord[],
  customPath?: string,
): ArchivedObjectiveRecord[] {
  if (records.length === 0) {
    return readArchivedObjectives(customPath);
  }
  return withArchivedObjectivesTransaction(customPath, (existing) => {
    const recordMap = new Map<string, ArchivedObjectiveRecord>();
    for (const item of existing) recordMap.set(item.id, item);
    for (const record of records) {
      const validated = validateArchivedObjectiveRecord(record);
      recordMap.set(validated.id, validated);
    }
    const merged = Array.from(recordMap.values());
    return { items: merged, result: merged };
  });
}

/**
 * Persists required global/local copies in one canonical order. Each copy owns a separate
 * transaction: root is always locked before its parent, and parents are visited in sorted
 * absolute-path order, so no operation can form an inverse parent-lock cycle.
 */
function appendArchivedObjectivesCopies(
  records: readonly ArchivedObjectiveRecord[],
  paths: readonly string[],
): void {
  const orderedPaths = [...new Set(paths.map((path) => resolve(path)))].sort((left, right) => {
    const parentOrder = dirname(left).localeCompare(dirname(right));
    return parentOrder === 0 ? left.localeCompare(right) : parentOrder;
  });
  for (const path of orderedPaths) appendArchivedObjectives(records, path);
}

/**
 * Determines whether a candidate, objective, or task is completed or closed.
 */
export function isItemCompleted(item: Record<string, unknown>): boolean {
  const status = typeof item["status"] === "string" ? item["status"].trim().toLowerCase() : "";
  const result = typeof item["result"] === "string" ? item["result"].trim().toLowerCase() : "";

  if (
    status === "completed" ||
    status === "converged" ||
    status === "resolved" ||
    status === "exhausted" ||
    status === "escalated" ||
    status === "closed" ||
    status === "declined"
  ) {
    return true;
  }

  if (
    result === "converged" ||
    result === "exhausted" ||
    result === "escalated" ||
    result === "completed" ||
    result === "resolved"
  ) {
    return true;
  }

  return false;
}

/**
 * Extracts generation number from an item, using fallback if not explicitly provided.
 */
export function extractItemGeneration(
  item: Record<string, unknown>,
  fallbackGeneration: number,
): number {
  if (typeof item["generation"] === "number" && Number.isFinite(item["generation"])) {
    return item["generation"];
  }

  if (typeof item["generation_id"] === "string") {
    const match = item["generation_id"].match(/(?:gen|generation)[-_]?(\d+)/i);
    if (match && match[1]) {
      const parsed = Number.parseInt(match[1], 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  if (typeof item["generation_id"] === "number" && Number.isFinite(item["generation_id"])) {
    return item["generation_id"];
  }

  return fallbackGeneration;
}

/**
 * Executes generational state archival and pruning during mind:rotate.
 *
 * Rule: Completed items older than `retentionGenerations` (default: 2 generations,
 * i.e., generation <= currentGeneration - 2) are pruned from active state and archived
 * durably to ARCHIVED_OBJECTIVES.jsonl.
 *
 * Recent items (within last 2 generations: current and current - 1) and active items
 * remain in the carried active state.
 */
export function pruneAndArchiveGenerationalState(
  options: PruneAndArchiveOptions,
): PruneAndArchiveResult {
  const { sourceState, sourceGeneration } = options;
  const retention = options.retentionGenerations ?? 2;
  const cutoffGeneration = sourceGeneration - retention;
  const nowIso = options.nowIso ?? new Date().toISOString();

  const toArchive: ArchivedObjectiveRecord[] = [];
  const carriedCandidates: CandidateRecord[] = [];
  const carriedObjectives: ObjectiveRecord[] = [];
  const carriedTasks: Record<string, unknown>[] = [];

  // 1. Process Candidates
  const candidates = Array.isArray(sourceState["candidates"])
    ? (sourceState["candidates"] as Record<string, unknown>[])
    : [];

  for (const cand of candidates) {
    const candidateId = typeof cand["id"] === "string" ? cand["id"] : "cand-unknown";
    const status = typeof cand["status"] === "string" ? cand["status"] : "opened";
    const statement =
      typeof cand["statement"] === "string" ? cand["statement"] : `Candidate ${candidateId}`;
    const candGen = extractItemGeneration(cand, sourceGeneration);
    const completed = isItemCompleted(cand);

    if (completed && candGen <= cutoffGeneration) {
      // Archive and prune from active state
      const completedAt =
        typeof cand["decided_at"] === "string" && cand["decided_at"]
          ? cand["decided_at"]
          : typeof cand["completed_at"] === "string" && cand["completed_at"]
            ? cand["completed_at"]
            : nowIso;

      const result = typeof cand["result"] === "string" && cand["result"] ? cand["result"] : status;

      toArchive.push({
        id: candidateId,
        type: "candidate",
        statement,
        generation: candGen,
        completed_at: completedAt,
        result,
        candidate_id: candidateId,
        write_scope: Array.isArray(cand["write_scope"])
          ? (cand["write_scope"] as string[])
          : undefined,
        charter_goals: Array.isArray(cand["charter_goals"])
          ? (cand["charter_goals"] as string[])
          : Array.isArray(cand["charter_goal_ids"])
            ? (cand["charter_goal_ids"] as string[])
            : undefined,
        details: {
          kind: cand["kind"],
          decline_reason: cand["decline_reason"],
          gate_failed: cand["gate_failed"],
          rationale: cand["rationale"],
        },
      });
    } else {
      // Retain in active carried state (either active or recent generation)
      carriedCandidates.push(cand as unknown as CandidateRecord);
    }
  }

  // 2. Process Objectives
  const objectives = Array.isArray(sourceState["objectives"])
    ? (sourceState["objectives"] as Record<string, unknown>[])
    : [];

  for (const obj of objectives) {
    const objId = typeof obj["id"] === "string" ? obj["id"] : "obj-unknown";
    const status = typeof obj["status"] === "string" ? obj["status"] : "active";
    const statement =
      typeof obj["statement"] === "string" ? obj["statement"] : `Objective ${objId}`;
    const objGen = extractItemGeneration(obj, sourceGeneration);
    const completed = isItemCompleted(obj);

    if (completed && objGen <= cutoffGeneration) {
      // Archive and prune
      const completedAt =
        typeof obj["updated_at"] === "string" && obj["updated_at"]
          ? obj["updated_at"]
          : typeof obj["completed_at"] === "string" && obj["completed_at"]
            ? obj["completed_at"]
            : nowIso;

      toArchive.push({
        id: objId,
        type: "objective",
        statement,
        generation: objGen,
        completed_at: completedAt,
        result: status,
        objective_id: objId,
        candidate_id: typeof obj["candidate_id"] === "string" ? obj["candidate_id"] : undefined,
        details: {
          current_round: obj["current_round"],
          max_rounds: obj["max_rounds"],
          rounds_count: Array.isArray(obj["rounds"]) ? obj["rounds"].length : 0,
        },
      });
    } else {
      carriedObjectives.push(obj as unknown as ObjectiveRecord);
    }
  }

  // 3. Process Tasks
  const rawTasks = sourceState["tasks"];
  const taskList: Record<string, unknown>[] = [];
  if (Array.isArray(rawTasks)) {
    for (const t of rawTasks) {
      if (typeof t === "object" && t !== null) taskList.push(t as Record<string, unknown>);
    }
  } else if (typeof rawTasks === "object" && rawTasks !== null) {
    for (const t of Object.values(rawTasks as Record<string, unknown>)) {
      if (typeof t === "object" && t !== null) taskList.push(t as Record<string, unknown>);
    }
  }

  for (const task of taskList) {
    const taskId = typeof task["id"] === "string" ? task["id"] : "task-unknown";
    const status = typeof task["status"] === "string" ? task["status"] : "unknown";
    const label = typeof task["label"] === "string" ? task["label"] : taskId;
    const taskGen = extractItemGeneration(task, sourceGeneration);
    const completed = isItemCompleted(task);

    if (completed && taskGen <= cutoffGeneration) {
      const completedAt =
        typeof task["completed_at"] === "string" && task["completed_at"]
          ? task["completed_at"]
          : nowIso;

      toArchive.push({
        id: taskId,
        type: "task",
        statement: label,
        generation: taskGen,
        completed_at: completedAt,
        result: status,
        task_id: taskId,
        write_scope: Array.isArray(task["write_scope"])
          ? (task["write_scope"] as string[])
          : undefined,
        details: {
          role: task["role"],
          status,
        },
      });
    } else {
      carriedTasks.push(task);
    }
  }

  // 4. Durable write to ARCHIVED_OBJECTIVES.jsonl
  const archivalPath = resolveArchivedObjectivesPath(
    options.capsulesDir,
    options.customArchivalPath,
  );

  if (toArchive.length > 0) {
    const requiredArchiveCopies = [archivalPath];
    // Also persist inside source capsule directory if available. Both copies are mandatory
    // once selected; appendArchivedObjectivesCopies intentionally propagates any failure.
    if (options.sourceRunRoot && existsSync(options.sourceRunRoot)) {
      requiredArchiveCopies.push(join(options.sourceRunRoot, "ARCHIVED_OBJECTIVES.jsonl"));
    }
    appendArchivedObjectivesCopies(toArchive, requiredArchiveCopies);
  }

  // 5. Prune boilerplate subdirectories & consolidate legacy capsule roots if requested
  const prunedBoilerplateDirs: string[] = [];
  if (options.pruneBoilerplateOnDisk !== false) {
    if (options.sourceRunRoot && existsSync(options.sourceRunRoot)) {
      const pruneRes = pruneCapsuleBoilerplate(options.sourceRunRoot);
      prunedBoilerplateDirs.push(...pruneRes.prunedDirectories);
    }
    if (options.targetRunRoot && existsSync(options.targetRunRoot)) {
      const pruneRes = pruneCapsuleBoilerplate(options.targetRunRoot);
      prunedBoilerplateDirs.push(...pruneRes.prunedDirectories);
    }
  }

  let consolidatedCapsules: ConsolidateCapsulesResult | undefined;
  if (options.consolidateCapsulesOnDisk && options.capsulesDir && existsSync(options.capsulesDir)) {
    consolidatedCapsules = consolidateCapsules(options.capsulesDir, {
      currentGeneration: sourceGeneration,
      retentionGenerations: retention,
      pruneBoilerplate: options.pruneBoilerplateOnDisk !== false,
    });
  }

  return {
    archivedRecords: toArchive,
    carriedCandidates,
    carriedObjectives,
    carriedTasks,
    prunedCount: toArchive.length,
    archivedCount: toArchive.length,
    archivalPath,
    ...(consolidatedCapsules !== undefined ? { consolidatedCapsules } : {}),
    ...(prunedBoilerplateDirs.length > 0
      ? { prunedBoilerplateDirectories: prunedBoilerplateDirs }
      : {}),
  };
}

/**
 * Checks whether a directory is empty or contains only ignorable OS files / empty subdirectories.
 */
export function isEffectivelyEmptyDirectory(dirPath: string): boolean {
  if (!existsSync(dirPath)) return true;
  try {
    const stat = lstatSync(dirPath);
    if (!stat.isDirectory()) return false;
    const entries = readdirSync(dirPath);
    if (entries.length === 0) return true;

    for (const entry of entries) {
      if (entry === ".DS_Store") continue;
      const childPath = join(dirPath, entry);
      try {
        const childStat = lstatSync(childPath);
        if (!childStat.isDirectory()) return false;
        if (!isEffectivelyEmptyDirectory(childPath)) return false;
      } catch {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Prunes empty boilerplate subdirectories from an active or archived capsule.
 * Preserves core files and any directory that contains files or data.
 */
export function pruneCapsuleBoilerplate(
  capsulePath: string,
  options: PruneBoilerplateOptions = {},
): PruneBoilerplateResult {
  if (!capsulePath || !existsSync(capsulePath)) {
    throw new HarnessError("INVALID_ARGUMENT", `capsulePath must exist: ${capsulePath}`);
  }
  const resolved = resolve(capsulePath);
  const stat = lstatSync(resolved);
  if (!stat.isDirectory()) {
    throw new HarnessError("INVALID_ARGUMENT", `capsulePath must be a directory: ${capsulePath}`);
  }

  const subdirs = options.subdirectories ?? BOILERPLATE_CAPSULE_SUBDIRECTORIES;
  const prunedDirectories: string[] = [];
  const preservedDirectories: string[] = [];

  for (const subdir of subdirs) {
    const targetPath = join(resolved, subdir);
    if (!existsSync(targetPath)) continue;
    try {
      const subStat = lstatSync(targetPath);
      if (!subStat.isDirectory()) {
        preservedDirectories.push(subdir);
        continue;
      }
      if (isEffectivelyEmptyDirectory(targetPath)) {
        if (!options.dryRun) {
          safeRmSync(targetPath, { allowedRoots: [resolved], missingOk: true });
        }
        prunedDirectories.push(subdir);
      } else {
        preservedDirectories.push(subdir);
      }
    } catch {
      preservedDirectories.push(subdir);
    }
  }

  return {
    capsulePath: resolved,
    prunedDirectories,
    preservedDirectories,
  };
}

function collectCapsuleFileManifest(root: string): Map<string, number> {
  const manifest = new Map<string, number>();
  const walk = (absDir: string, relDir: string): void => {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const relPath = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      const absPath = join(absDir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        walk(absPath, relPath);
        continue;
      }
      if (entry.isFile()) {
        manifest.set(relPath, statSync(absPath).size);
      }
    }
  };
  walk(root, "");
  return manifest;
}

export function assertCapsuleCopyComplete(sourceRoot: string, targetRoot: string): void {
  const sourceManifest = collectCapsuleFileManifest(sourceRoot);
  if (!existsSync(targetRoot)) {
    throw new HarnessError(
      "INTEGRITY",
      `archiveCapsule: copy target does not exist after cpSync: '${targetRoot}'; refusing to delete source '${sourceRoot}'`,
    );
  }
  const targetManifest = collectCapsuleFileManifest(targetRoot);
  for (const [relPath, size] of sourceManifest) {
    const copiedSize = targetManifest.get(relPath);
    if (copiedSize === undefined) {
      throw new HarnessError(
        "INTEGRITY",
        `archiveCapsule: cross-device copy of '${sourceRoot}' is missing '${relPath}' in '${targetRoot}'; refusing to delete the source until the copy is verified complete`,
      );
    }
    if (copiedSize !== size) {
      throw new HarnessError(
        "INTEGRITY",
        `archiveCapsule: cross-device copy of '${relPath}' has size ${copiedSize}, expected ${size}; refusing to delete source '${sourceRoot}' until the copy is verified complete`,
      );
    }
  }
}

/**
 * Archives a legacy capsule root by moving it to .capsules/archive/<runId>
 * and pruning empty boilerplate subdirectories.
 */
export function archiveCapsule(
  sourceCapsulePath: string,
  options: ArchiveCapsuleOptions = {},
): ArchiveCapsuleResult {
  if (!sourceCapsulePath || !existsSync(sourceCapsulePath)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `sourceCapsulePath must exist: ${sourceCapsulePath}`,
    );
  }
  const resolvedSource = resolve(sourceCapsulePath);
  const stat = lstatSync(resolvedSource);
  if (!stat.isDirectory()) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `sourceCapsulePath must be a directory: ${sourceCapsulePath}`,
    );
  }

  const runId = basename(resolvedSource);
  const parentDir = dirname(resolvedSource);
  const archiveDir = options.targetArchiveDir
    ? resolve(options.targetArchiveDir)
    : join(parentDir, "archive");
  const targetPath = join(archiveDir, runId);
  const allowedRoots = [...new Set([parentDir, archiveDir])];
  const allowGitRepositoryDeletion = options.allowGitRepositoryDeletion ?? false;

  if (existsSync(targetPath)) {
    if (options.overwrite) {
      if (!options.dryRun) {
        safeRmSync(targetPath, { allowedRoots, allowGitRepositoryDeletion, missingOk: true });
      }
    } else {
      throw new HarnessError(
        "INVALID_STATE",
        `Target archived capsule already exists: ${targetPath}`,
      );
    }
  }

  let prunedDirectories: string[] = [];

  if (!options.dryRun) {
    if (!existsSync(archiveDir)) {
      mkdirSync(archiveDir, { recursive: true, mode: 0o755 });
    }
    try {
      safeRenameSync(resolvedSource, targetPath, { allowedRoots, allowGitRepositoryDeletion });
    } catch (error) {
      if (error instanceof HarnessError) throw error;
      safeCpSync(resolvedSource, targetPath, { allowedRoots });
      assertCapsuleCopyComplete(resolvedSource, targetPath);
      safeRmSync(resolvedSource, { allowedRoots, allowGitRepositoryDeletion, missingOk: true });
    }

    if (options.pruneBoilerplate !== false) {
      const pruneRes = pruneCapsuleBoilerplate(targetPath);
      prunedDirectories = [...pruneRes.prunedDirectories];
    }
  }

  return {
    sourcePath: resolvedSource,
    archivedPath: targetPath,
    runId,
    prunedDirectories,
  };
}

/**
 * Consolidates capsules in a capsules directory:
 * - Archives legacy roots into .capsules/archive/
 * - Prunes boilerplate subdirectories to keep active capsule roots minimal
 */
export function consolidateCapsules(
  capsulesDir: string,
  options: ConsolidateCapsulesOptions = {},
): ConsolidateCapsulesResult {
  if (!capsulesDir || !existsSync(capsulesDir)) {
    throw new HarnessError("INVALID_ARGUMENT", `capsulesDir must exist: ${capsulesDir}`);
  }
  const resolvedCapsulesDir = resolve(capsulesDir);
  const stat = lstatSync(resolvedCapsulesDir);
  if (!stat.isDirectory()) {
    throw new HarnessError("INVALID_ARGUMENT", `capsulesDir must be a directory: ${capsulesDir}`);
  }

  const targetArchiveDir = options.targetArchiveDir
    ? resolve(options.targetArchiveDir)
    : join(resolvedCapsulesDir, "archive");

  const retention = options.retentionGenerations ?? 2;
  const currentGen = options.currentGeneration;
  const cutoffGen = currentGen !== undefined ? currentGen - retention : undefined;
  const activeRunIdsSet = options.activeRunIds ? new Set(options.activeRunIds) : undefined;

  const pruneBoilerplate = options.pruneBoilerplate ?? true;

  const entries = readdirSync(resolvedCapsulesDir);
  const activeCapsules: string[] = [];
  const archivedCapsules: string[] = [];
  let prunedSubdirectoriesCount = 0;

  for (const entry of entries) {
    if (entry.startsWith(".") || entry === "archive") continue;
    const fullPath = join(resolvedCapsulesDir, entry);
    let entryStat;
    try {
      entryStat = lstatSync(fullPath);
    } catch {
      continue;
    }
    if (!entryStat.isDirectory() || entryStat.isSymbolicLink()) continue;

    // Verify if it's a capsule directory (has manifest.json or prompt.md or state.json)
    const isCapsule =
      existsSync(join(fullPath, "manifest.json")) ||
      existsSync(join(fullPath, "state.json")) ||
      existsSync(join(fullPath, "prompt.md"));

    if (!isCapsule) continue;

    // Determine if entry is legacy
    let isLegacy = false;

    if (activeRunIdsSet !== undefined) {
      isLegacy = !activeRunIdsSet.has(entry);
    } else if (cutoffGen !== undefined) {
      const genMatch = entry.match(/(?:mind-)?gen[-_]?(\d+)/i);
      if (genMatch && genMatch[1]) {
        const parsedGen = Number.parseInt(genMatch[1], 10);
        if (Number.isFinite(parsedGen) && parsedGen <= cutoffGen) {
          isLegacy = true;
        }
      }
    }

    // Also check state for completed / rotated mind or run if neither explicit active list nor gen cutoff flagged it
    if (!isLegacy && activeRunIdsSet === undefined && cutoffGen === undefined) {
      try {
        const statePath = join(fullPath, "state.json");
        if (existsSync(statePath)) {
          const stateRaw = JSON.parse(readFileSync(statePath, "utf-8")) as Record<string, unknown>;
          const mindState = stateRaw["mind"] as Record<string, unknown> | undefined;
          const completionResult = stateRaw["completion_result"] as
            | Record<string, unknown>
            | undefined;
          if (mindState?.status === "rotated" || completionResult?.status === "complete") {
            if (typeof mindState?.generation === "number" && currentGen !== undefined) {
              if (mindState.generation <= currentGen - retention) {
                isLegacy = true;
              }
            }
          }
        }
      } catch {
        // Skip read error
      }
    }

    if (isLegacy) {
      const archiveRes = archiveCapsule(fullPath, {
        targetArchiveDir,
        pruneBoilerplate,
        overwrite: true,
        dryRun: options.dryRun,
      });
      archivedCapsules.push(entry);
      prunedSubdirectoriesCount += archiveRes.prunedDirectories.length;
    } else {
      activeCapsules.push(entry);
      if (pruneBoilerplate) {
        const pruneRes = pruneCapsuleBoilerplate(fullPath, { dryRun: options.dryRun });
        prunedSubdirectoriesCount += pruneRes.prunedDirectories.length;
      }
    }
  }

  return {
    capsulesDir: resolvedCapsulesDir,
    activeCapsules,
    archivedCapsules,
    prunedSubdirectoriesCount,
    archiveDir: targetArchiveDir,
  };
}
