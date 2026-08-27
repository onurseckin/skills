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
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { enforceLineLimit, formatTable } from "../cli/formatters/line-limiter.ts";
import { nextActionsBlock } from "../cli/formatters/next-actions.ts";
import { HarnessError } from "../core/errors/harness-error.ts";
import { releaseFlock, tryExclusiveFlock } from "../platform/flock-ffi.ts";
import { isTestEnvironment, resolveScratchDir } from "../core/shared/paths.ts";
import {
  resolveFeedbackQueuePath,
  updateOrPruneFeedbackItems,
  validateFeedbackResolutionProof,
  type FeedbackResolutionProof,
} from "./feedback-queue.ts";

export type CompletedTaskSource =
  | "feedback_queue"
  | "defect"
  | "task_queue"
  | "mind_plan"
  | "direct"
  | "external";

export type CompletedTaskStatus = "COMPLETED" | "RESOLVED";

export interface CompletedTaskRecord {
  readonly id: string;
  readonly source: CompletedTaskSource;
  readonly title: string;
  readonly status: CompletedTaskStatus;
  readonly generation_id?: string | null | undefined;
  readonly commit_sha?: string | null | undefined;
  readonly proof_summary: string;
  readonly completed_at: string;
  readonly category?: string | null | undefined;
  readonly test_path?: string | null | undefined;
  readonly assertions?: number | string | readonly string[] | null | undefined;
  readonly runtime_ms?: number | string | null | undefined;
  readonly resolution?: FeedbackResolutionProof | null | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface CompletedTasksStats {
  readonly total: number;
  readonly by_source: Record<string, number>;
  readonly by_category: Record<string, number>;
}

export interface RecordCompletedTaskOptions {
  readonly customPath?: string | undefined;
  readonly feedbackQueuePath?: string | undefined;
  readonly updateFeedbackQueue?: boolean | undefined;
  readonly defectsPath?: string | undefined;
  readonly updateDefects?: boolean | undefined;
}

export const CANONICAL_COMPLETED_TASKS_FILE = "olt/completed-tasks.jsonl";
export const DEFAULT_COMPLETED_TASKS_FILE = "olt/completed-tasks.jsonl";

export const CANONICAL_DEFECTS_FILE = "olt/defects.jsonl";
export const DEFAULT_DEFECTS_FILE = "olt/defects.jsonl";

export const CANONICAL_COMPLETED_DEFECTS_FILE = "olt/completed-defects.jsonl";
export const DEFAULT_COMPLETED_DEFECTS_FILE = "olt/completed-defects.jsonl";

export const CANONICAL_OBSERVATIONS_FILE = "olt/telemetry.jsonl";
export const DEFAULT_OBSERVATIONS_FILE = "olt/telemetry.jsonl";

type LedgerPersistenceStage =
  | "before_write"
  | "before_file_fsync"
  | "before_rename"
  | "after_rename"
  | "before_directory_fsync";
let ledgerPersistenceTestHook: ((stage: LedgerPersistenceStage) => void) | undefined;

/** @internal deterministic persistence seam for the unit suite. */
export function __setCompletedTasksPersistenceTestHook(
  hook: ((stage: LedgerPersistenceStage) => void) | undefined,
): void {
  ledgerPersistenceTestHook = hook;
}

function invokeLedgerPersistenceHook(stage: LedgerPersistenceStage): void {
  ledgerPersistenceTestHook?.(stage);
}

export function resolveCanonicalCompletedTasksPath(customRoot?: string, _useTodo = false): string {
  const root = customRoot || (isTestEnvironment() ? resolveScratchDir() : process.cwd());
  return join(root, ".olt", "completed-tasks.jsonl");
}

export function resolveCompletedTasksLedgerPath(customPath?: string): string {
  if (customPath && customPath.trim()) return resolve(customPath.trim());
  return resolveCanonicalCompletedTasksPath();
}

export function resolveCanonicalDefectsPath(customRoot?: string, _useTodo = false): string {
  const root = customRoot || (isTestEnvironment() ? resolveScratchDir() : process.cwd());
  return join(root, ".olt", "defects.jsonl");
}

export function resolveDefectsPath(customPath?: string): string {
  if (customPath && customPath.trim()) return resolve(customPath.trim());
  return resolveCanonicalDefectsPath();
}

export function resolveCanonicalCompletedDefectsPath(
  customRoot?: string,
  _useTodo = false,
): string {
  const root = customRoot || (isTestEnvironment() ? resolveScratchDir() : process.cwd());
  return join(root, ".olt", "completed-defects.jsonl");
}

export function resolveCompletedDefectsPath(customPath?: string): string {
  if (customPath && customPath.trim()) return resolve(customPath.trim());
  return resolveCanonicalCompletedDefectsPath();
}

export function resolveCanonicalObservationsPath(customRoot?: string, _useTodo = false): string {
  const root = customRoot || (isTestEnvironment() ? resolveScratchDir() : process.cwd());
  return join(root, ".olt", "telemetry.jsonl");
}

export function resolveObservationsPath(customPath?: string): string {
  if (customPath && customPath.trim()) return resolve(customPath.trim());
  return resolveCanonicalObservationsPath();
}

function isOwnCode(error: unknown, code: string): boolean {
  if (!(error instanceof Error)) return false;
  return Object.getOwnPropertyDescriptor(error, "code")?.value === code;
}

function readLedgerFile(filePath: string): string | undefined {
  let descriptor: number | undefined;
  try {
    const before = lstatSync(filePath);
    if (!before.isFile() || before.nlink !== 1) {
      throw new HarnessError(
        "INTEGRITY",
        "completed tasks ledger must be a single-link regular file",
      );
    }
    descriptor = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino
    ) {
      throw new HarnessError("INTEGRITY", "completed tasks ledger changed while being opened");
    }
    const raw = readFileSync(descriptor, "utf8");
    const after = lstatSync(filePath);
    if (
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      !after.isFile() ||
      after.nlink !== 1
    ) {
      throw new HarnessError("INTEGRITY", "completed tasks ledger changed while being read");
    }
    return raw;
  } catch (error) {
    if (isOwnCode(error, "ENOENT")) return undefined;
    if (error instanceof HarnessError) throw error;
    throw new HarnessError("INTEGRITY", "could not securely read completed tasks ledger");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function withLedgerTransaction<T>(filePath: string, mutation: () => T): T {
  const parent = dirname(filePath);
  const candidateRoot = dirname(parent);
  const root = candidateRoot === "/" ? parent : candidateRoot;
  let rootFd: number | undefined;
  let parentFd: number | undefined;
  let rootLocked = false;
  let parentLocked = false;
  let primary: unknown;
  let primaryThrown = false;
  let result!: T;
  try {
    rootFd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const rootStat = fstatSync(rootFd);
    const rootPath = lstatSync(root);
    if (!rootStat.isDirectory() || rootStat.dev !== rootPath.dev || rootStat.ino !== rootPath.ino)
      throw new HarnessError("INTEGRITY", "ledger root changed");
    for (let attempt = 0; attempt < 200 && !rootLocked; attempt++) {
      rootLocked = tryExclusiveFlock(rootFd);
      if (!rootLocked) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
    if (!rootLocked)
      throw new HarnessError("LOCK_TIMEOUT", "completed tasks ledger root is locked");
    try {
      mkdirSync(parent);
    } catch (error) {
      if (!isOwnCode(error, "EEXIST")) throw error;
    }
    parentFd = openSync(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const parentStat = fstatSync(parentFd);
    const parentPath = lstatSync(parent);
    if (
      !parentStat.isDirectory() ||
      parentStat.dev !== parentPath.dev ||
      parentStat.ino !== parentPath.ino
    )
      throw new HarnessError("INTEGRITY", "ledger parent changed");
    for (let attempt = 0; attempt < 200 && !parentLocked; attempt++) {
      parentLocked = tryExclusiveFlock(parentFd);
      if (!parentLocked) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
    if (!parentLocked)
      throw new HarnessError("LOCK_TIMEOUT", "completed tasks ledger parent is locked");
    result = mutation();
  } catch (error) {
    primaryThrown = true;
    primary = error;
  }
  let cleanup: unknown;
  let cleanupThrown = false;
  for (const action of [
    () => {
      if (parentLocked && parentFd !== undefined) releaseFlock(parentFd);
    },
    () => {
      if (rootLocked && rootFd !== undefined) releaseFlock(rootFd);
    },
    () => {
      if (parentFd !== undefined) closeSync(parentFd);
    },
    () => {
      if (rootFd !== undefined) closeSync(rootFd);
    },
  ]) {
    try {
      action();
    } catch (error) {
      if (!cleanupThrown) {
        cleanupThrown = true;
        cleanup = error;
      }
    }
  }
  if (primaryThrown) throw primary;
  if (cleanupThrown) throw cleanup;
  return result;
}

function atomicWriteLedger(filePath: string, raw: string): void {
  const parent = dirname(filePath);
  let old: { dev: number; ino: number } | undefined;
  try {
    const stat = lstatSync(filePath);
    if (!stat.isFile() || stat.nlink !== 1)
      throw new HarnessError(
        "INTEGRITY",
        "completed tasks ledger must be a single-link regular file",
      );
    old = stat;
  } catch (error) {
    if (!isOwnCode(error, "ENOENT")) throw error;
  }
  const temporary = join(parent, `.completed-tasks.${process.pid}.${Date.now()}.tmp`);
  let fd: number | undefined;
  let dirFd: number | undefined;
  let renamed = false;
  try {
    fd = openSync(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    const bytes = Buffer.from(raw);
    let offset = 0;
    while (offset < bytes.length) {
      invokeLedgerPersistenceHook("before_write");
      const written = writeSync(fd, bytes, offset, bytes.length - offset);
      if (written <= 0)
        throw new HarnessError("INTEGRITY", "could not write completed tasks ledger");
      offset += written;
    }
    invokeLedgerPersistenceHook("before_file_fsync");
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    try {
      const current = lstatSync(filePath);
      if (
        !old ||
        !current.isFile() ||
        current.nlink !== 1 ||
        current.dev !== old.dev ||
        current.ino !== old.ino
      )
        throw new HarnessError("INTEGRITY", "completed tasks ledger changed before replacement");
    } catch (error) {
      if (!(old === undefined && isOwnCode(error, "ENOENT"))) throw error;
    }
    invokeLedgerPersistenceHook("before_rename");
    renameSync(temporary, filePath);
    renamed = true;
    invokeLedgerPersistenceHook("after_rename");
    dirFd = openSync(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    invokeLedgerPersistenceHook("before_directory_fsync");
    fsyncSync(dirFd);
  } catch (error) {
    if (renamed)
      throw new HarnessError(
        "INTEGRITY",
        "completed tasks ledger mutation outcome is uncertain and possibly committed after rename",
      );
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (dirFd !== undefined) closeSync(dirFd);
    if (!renamed) {
      try {
        unlinkSync(temporary);
      } catch (error) {
        if (!isOwnCode(error, "ENOENT")) throw error;
      }
    }
  }
}

export function validateCompletedTaskSource(val: unknown): CompletedTaskSource {
  if (typeof val === "string") {
    const lower = val.trim().toLowerCase();
    if (lower === "feedback_queue" || lower === "feedback") return "feedback_queue";
    if (lower === "defect" || lower === "defects") return "defect";
    if (lower === "task_queue" || lower === "queue") return "task_queue";
    if (lower === "mind_plan" || lower === "plan") return "mind_plan";
    if (lower === "direct") return "direct";
    if (lower === "external") return "external";
  }
  throw new HarnessError("INTEGRITY", "CompletedTaskRecord requires valid source");
}

export function validateCompletedTaskStatus(val: unknown): CompletedTaskStatus {
  if (typeof val === "string") {
    const upper = val.trim().toUpperCase();
    if (upper === "RESOLVED") return "RESOLVED";
    if (upper === "COMPLETED") return "COMPLETED";
  }
  throw new HarnessError("INTEGRITY", "CompletedTaskRecord requires valid status");
}

export function validateCompletedTaskRecord(raw: unknown): CompletedTaskRecord {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new HarnessError("INVALID_ARGUMENT", "CompletedTaskRecord must be an object");
  }

  const r = raw as Record<string, unknown>;
  const id = typeof r["id"] === "string" ? r["id"].trim() : "";
  if (!id) {
    throw new HarnessError("INVALID_ARGUMENT", "CompletedTaskRecord requires non-empty id");
  }

  const source = validateCompletedTaskSource(r["source"]);
  const status = validateCompletedTaskStatus(r["status"]);
  const title = typeof r["title"] === "string" && r["title"].trim() ? r["title"].trim() : "";
  if (!title) throw new HarnessError("INTEGRITY", `CompletedTaskRecord for '${id}' requires title`);
  const proofSummary = typeof r["proof_summary"] === "string" ? r["proof_summary"].trim() : "";
  if (!proofSummary) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `CompletedTaskRecord for '${id}' requires non-empty proof_summary`,
    );
  }

  const completedAt =
    typeof r["completed_at"] === "string" && r["completed_at"].trim()
      ? r["completed_at"].trim()
      : "";
  if (!completedAt || !Number.isFinite(Date.parse(completedAt))) {
    throw new HarnessError(
      "INTEGRITY",
      `CompletedTaskRecord for '${id}' requires valid completed_at`,
    );
  }

  const generationId =
    typeof r["generation_id"] === "string"
      ? r["generation_id"].trim()
      : r["generation_id"] === null
        ? null
        : undefined;

  const commitSha =
    typeof r["commit_sha"] === "string"
      ? r["commit_sha"].trim()
      : r["commit_sha"] === null
        ? null
        : undefined;

  const category =
    typeof r["category"] === "string"
      ? r["category"].trim()
      : r["category"] === null
        ? null
        : undefined;

  const testPath =
    typeof r["test_path"] === "string" && r["test_path"].trim()
      ? r["test_path"].trim()
      : r["test_path"] === null
        ? null
        : undefined;

  let assertions: number | string | readonly string[] | null | undefined = undefined;
  if (typeof r["assertions"] === "number" || typeof r["assertions"] === "string") {
    assertions = r["assertions"];
  } else if (Array.isArray(r["assertions"])) {
    assertions = r["assertions"].map((a) => String(a));
  } else if (r["assertions"] === null) {
    assertions = null;
  }

  let runtimeMs: number | string | null | undefined = undefined;
  if (typeof r["runtime_ms"] === "number" || typeof r["runtime_ms"] === "string") {
    runtimeMs = r["runtime_ms"];
  } else if (typeof r["runtime"] === "number" || typeof r["runtime"] === "string") {
    runtimeMs = r["runtime"] as number | string;
  } else if (r["runtime_ms"] === null || r["runtime"] === null) {
    runtimeMs = null;
  }

  let resolution: FeedbackResolutionProof | null | undefined = undefined;
  if (
    typeof r["resolution"] === "object" &&
    r["resolution"] !== null &&
    !Array.isArray(r["resolution"])
  ) {
    resolution = validateFeedbackResolutionProof(r["resolution"]);
  } else if (r["resolution"] !== undefined && r["resolution"] !== null) {
    throw new HarnessError("INTEGRITY", `CompletedTaskRecord for '${id}' has invalid resolution`);
  } else if (r["resolution"] === null) {
    resolution = null;
  }

  const metadata =
    typeof r["metadata"] === "object" && r["metadata"] !== null && !Array.isArray(r["metadata"])
      ? (r["metadata"] as Readonly<Record<string, unknown>>)
      : undefined;

  return {
    id,
    source,
    title,
    status,
    proof_summary: proofSummary,
    completed_at: completedAt,
    ...(generationId !== undefined ? { generation_id: generationId } : {}),
    ...(commitSha !== undefined ? { commit_sha: commitSha } : {}),
    ...(category !== undefined ? { category } : {}),
    ...(testPath !== undefined ? { test_path: testPath } : {}),
    ...(assertions !== undefined ? { assertions } : {}),
    ...(runtimeMs !== undefined ? { runtime_ms: runtimeMs } : {}),
    ...(resolution !== undefined ? { resolution } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

export function readCompletedTasksLedger(customPath?: string): CompletedTaskRecord[] {
  const filePath = resolveCompletedTasksLedgerPath(customPath);
  const raw = readLedgerFile(filePath);
  if (raw === undefined) return [];
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const items: CompletedTaskRecord[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      const validated = validateCompletedTaskRecord(parsed);
      items.push(validated);
    } catch (error) {
      if (error instanceof HarnessError) {
        throw new HarnessError(
          "INTEGRITY",
          `completed tasks ledger line ${i + 1}: ${error.message}`,
        );
      }
      throw new HarnessError("INTEGRITY", `completed tasks ledger line ${i + 1} is malformed`);
    }
  }

  return items;
}

export function writeCompletedTasksLedger(
  items: readonly CompletedTaskRecord[],
  customPath?: string,
): void {
  const filePath = resolveCompletedTasksLedgerPath(customPath);
  withLedgerTransaction(filePath, () => writeCompletedTasksLedgerUnlocked(items, filePath));
}

function writeCompletedTasksLedgerUnlocked(
  items: readonly CompletedTaskRecord[],
  filePath: string,
): void {
  const lines = items.map((item) => JSON.stringify(validateCompletedTaskRecord(item)));
  atomicWriteLedger(filePath, lines.join("\n") + (lines.length > 0 ? "\n" : ""));
}

function updateFeedbackQueueItems(
  records: readonly CompletedTaskRecord[],
  customPath?: string,
): void {
  const idMap = new Map<string, CompletedTaskRecord>();
  for (const r of records) {
    idMap.set(r.id.toLowerCase().trim(), r);
  }

  updateOrPruneFeedbackItems((item) => {
    const id = item.id.toLowerCase().trim();
    const candidateId = item.candidate_id?.toLowerCase().trim();
    const isCompleted =
      idMap.has(id) ||
      (candidateId !== undefined && idMap.has(candidateId)) ||
      item.status === "COMPLETED";
    return isCompleted ? null : item;
  }, resolveFeedbackQueuePath(customPath));
}

function updateDefectItems(records: readonly CompletedTaskRecord[], customPath?: string): void {
  const filePath = resolveDefectsPath(customPath);
  if (!existsSync(filePath)) {
    return;
  }
  const idMap = new Map<string, CompletedTaskRecord>();
  for (const r of records) {
    idMap.set(r.id.toLowerCase().trim(), r);
  }

  const raw = readFileSync(filePath, "utf8");
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const remainingLines: string[] = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const id = typeof parsed["id"] === "string" ? parsed["id"].toLowerCase().trim() : undefined;
      const isResolved =
        (id && idMap.has(id)) ||
        parsed["status"] === "resolved" ||
        parsed["status"] === "RESOLVED" ||
        parsed["status"] === "CLOSED";

      if (!isResolved) {
        remainingLines.push(line);
      }
    } catch {
      remainingLines.push(line);
    }
  }

  writeFileSync(
    filePath,
    remainingLines.join("\n") + (remainingLines.length > 0 ? "\n" : ""),
    "utf8",
  );
  return;
}

export function recordCompletedTasksBatch(
  records: readonly CompletedTaskRecord[],
  options?: RecordCompletedTaskOptions,
): CompletedTaskRecord[] {
  if (records.length === 0) {
    return [];
  }

  const filePath = resolveCompletedTasksLedgerPath(options?.customPath);
  const recorded = withLedgerTransaction(filePath, () =>
    recordCompletedTasksBatchUnlocked(records, options, filePath),
  );
  if (options?.updateFeedbackQueue) {
    updateFeedbackQueueItems(recorded, options.feedbackQueuePath);
  }
  return recorded;
}

function recordCompletedTasksBatchUnlocked(
  records: readonly CompletedTaskRecord[],
  options: RecordCompletedTaskOptions | undefined,
  filePath: string,
): CompletedTaskRecord[] {
  const existing = readCompletedTasksLedger(filePath);
  const ledgerMap = new Map<string, CompletedTaskRecord>();

  for (const item of existing) {
    ledgerMap.set(item.id, item);
  }

  const validatedRecords: CompletedTaskRecord[] = [];
  for (const r of records) {
    const validated = validateCompletedTaskRecord(r);
    ledgerMap.set(validated.id, validated);
    validatedRecords.push(validated);
  }

  const merged = Array.from(ledgerMap.values());
  writeCompletedTasksLedgerUnlocked(merged, filePath);

  if (options?.updateDefects) {
    updateDefectItems(validatedRecords, options?.defectsPath);
  }

  return validatedRecords;
}

export function recordCompletedTask(
  record: CompletedTaskRecord,
  options?: RecordCompletedTaskOptions,
): CompletedTaskRecord {
  const [recorded] = recordCompletedTasksBatch([record], options);
  if (!recorded) {
    throw new HarnessError("INVALID_ARGUMENT", "Failed to record completed task");
  }
  return recorded;
}

export function getCompletedTasksStats(
  records: readonly CompletedTaskRecord[],
): CompletedTasksStats {
  const by_source: Record<string, number> = {};
  const by_category: Record<string, number> = {};

  for (const record of records) {
    const src =
      typeof record.source === "string" && record.source.length > 0 ? record.source : "direct";
    by_source[src] = (by_source[src] ?? 0) + 1;

    const cat =
      record.category && record.category.trim() ? record.category.trim() : "uncategorized";
    by_category[cat] = (by_category[cat] ?? 0) + 1;
  }

  return {
    total: records.length,
    by_source,
    by_category,
  };
}

export function formatCompletedTasksBrief(
  records: readonly CompletedTaskRecord[],
  maxLines = 30,
): string {
  const stats = getCompletedTasksStats(records);
  const lines: string[] = [`### Completed Tasks Ledger`, `- **Total Completed**: ${stats.total}`];

  if (stats.total > 0) {
    const sourceBreakdown = Object.entries(stats.by_source)
      .map(([src, count]) => `${src}: ${count}`)
      .join(", ");
    lines.push(`- **By Source**: ${sourceBreakdown}`);

    if (Object.keys(stats.by_category).length > 0) {
      const categoryBreakdown = Object.entries(stats.by_category)
        .map(([cat, count]) => `${cat}: ${count}`)
        .join(", ");
      lines.push(`- **By Category**: ${categoryBreakdown}`);
    }

    lines.push("");
    lines.push("#### Recent Completions:");
    const recent = records.slice(-5).reverse();
    const tableRows = recent.map((r) => [
      r.id,
      r.source,
      r.status,
      r.title.length > 30 ? `${r.title.slice(0, 27)}...` : r.title,
    ]);
    lines.push(...formatTable(["ID", "Source", "Status", "Title"], tableRows));
  } else {
    lines.push("- **Status**: No tasks completed yet in ledger.");
  }

  lines.push(
    ...nextActionsBlock([
      {
        command: "bun harness.ts mind:wake",
        role: "Mind",
        description: "Wake substrate to continue autonomous task loop",
      },
      {
        command: "bun harness.ts queue:list",
        role: "Coordinator",
        description: "Inspect remaining active queue tasks",
      },
    ]),
  );

  return enforceLineLimit(lines.join("\n"), maxLines);
}

export function migrateCompletedTasksLedger(options: { sourcePath: string; targetPath?: string }): {
  migrated: boolean;
  count: number;
} {
  const target = resolveCompletedTasksLedgerPath(options.targetPath);
  if (!existsSync(options.sourcePath) || options.sourcePath === target) {
    return { migrated: false, count: 0 };
  }
  const records = readCompletedTasksLedger(options.sourcePath);
  if (records.length === 0) {
    return { migrated: false, count: 0 };
  }
  return withLedgerTransaction(target, () => {
    const existing = readCompletedTasksLedger(target);
    const map = new Map<string, CompletedTaskRecord>();
    for (const r of existing) map.set(r.id, r);
    for (const r of records) map.set(r.id, r);
    writeCompletedTasksLedgerUnlocked(Array.from(map.values()), target);
    return { migrated: true, count: records.length };
  });
}
