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
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { HarnessError } from "../core/errors/index.ts";
import { isTestEnvironment, resolveScratchDir } from "../core/shared/paths.ts";
import { releaseFlock, tryExclusiveFlock } from "../platform/index.ts";
import { resolveTaskQueuePath } from "./task-queue.ts";

export type FeedbackPriority =
  | "CRITICAL_USER_FEEDBACK"
  | "HIGH_ARCHITECTURAL_FEATURE"
  | "USER_DIRECTIVE"
  | "NORMAL"
  | "LOW";

export type FeedbackStatus = "PENDING" | "ADMITTED" | "DECLINED" | "PROCESSED" | "COMPLETED";

export type FeedbackCategory =
  | "DOCUMENTATION"
  | "AGENT_CONTRACTS"
  | "CLI_TOOLING"
  | "WATCHDOG"
  | "SCALING"
  | "ARCHITECTURE"
  | "CORE_ENGINE"
  | "REPAIR"
  | "GENERAL";

export interface FeedbackResolutionProof {
  readonly task_id: string;
  readonly resolved_at: string;
  readonly test_path?: string | null | undefined;
  readonly test_assertion?: string | null | undefined;
  readonly assertions?: number | string | readonly string[] | null | undefined;
  readonly runtime_ms?: number | string | null | undefined;
  readonly commit_sha?: string | null | undefined;
  readonly proof_summary?: string | null | undefined;
  readonly verified_by?: string | null | undefined;
  readonly remediation_notes?: string | null | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface FeedbackItem {
  readonly id: string;
  readonly timestamp: string;
  readonly priority: FeedbackPriority;
  readonly status: FeedbackStatus;
  readonly category: FeedbackCategory;
  readonly title: string;
  readonly content: string;
  readonly candidate_id?: string | null | undefined;
  readonly resolution_note?: string | null | undefined;
  readonly processed_at?: string | null | undefined;
  readonly resolution?: FeedbackResolutionProof | null | undefined;
  readonly test_path?: string | null | undefined;
  readonly assertions?: number | string | readonly string[] | null | undefined;
  readonly runtime_ms?: number | string | null | undefined;
  readonly commit_sha?: string | null | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface FeedbackQueueStats {
  readonly total: number;
  readonly pending: number;
  readonly admitted: number;
  readonly declined: number;
  readonly processed: number;
  readonly completed: number;
}

export interface AtomicAdmissionDispatchResult {
  readonly feedback_item: FeedbackItem;
  readonly dispatched_task_id: string;
  readonly admitted_at: string;
  readonly auto_enqueued: boolean;
}

export interface AdmissionDispatchIntegrityReport {
  readonly is_compliant: boolean;
  readonly total_feedback_items: number;
  readonly admitted_feedback_count: number;
  readonly paused_admitted_feedback_count: number;
  readonly paused_admitted_feedbacks: readonly FeedbackItem[];
  readonly active_dispatched_feedback_count: number;
  readonly violations: readonly string[];
}

export interface BackpropagationRecord {
  readonly id: string;
  readonly commit_sha?: string | null | undefined;
  readonly proof_summary?: string | null | undefined;
  readonly completed_at?: string | null | undefined;
  readonly test_path?: string | null | undefined;
  readonly assertions?: number | string | readonly string[] | null | undefined;
  readonly runtime_ms?: number | string | null | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly resolution?: FeedbackResolutionProof | null | undefined;
}

export const CANONICAL_FEEDBACK_FILE = "olt/backlog.jsonl";

export const DEFAULT_FEEDBACK_FILE = "olt/backlog.jsonl";

export const PRIORITY_ORDER: Record<FeedbackPriority, number> = {
  CRITICAL_USER_FEEDBACK: 1,
  HIGH_ARCHITECTURAL_FEATURE: 2,
  USER_DIRECTIVE: 3,
  NORMAL: 4,
  LOW: 5,
};

type FeedbackQueuePersistenceStage =
  | "before_write"
  | "before_file_fsync"
  | "before_rename"
  | "after_rename"
  | "before_directory_fsync";
let feedbackQueuePersistenceTestHook: ((stage: FeedbackQueuePersistenceStage) => void) | undefined;
const feedbackQueueLockSleep = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));

/** @internal Narrow deterministic durability seam for the unit suite. */
export function __setFeedbackQueuePersistenceTestHook(
  hook: ((stage: FeedbackQueuePersistenceStage) => void) | undefined,
): void {
  feedbackQueuePersistenceTestHook = hook;
}

function invokeFeedbackQueuePersistenceHook(stage: FeedbackQueuePersistenceStage): void {
  feedbackQueuePersistenceTestHook?.(stage);
}

function noFollowFlag(): number {
  if (typeof constants.O_NOFOLLOW !== "number")
    throw new HarnessError("UNSUPPORTED_PLATFORM", "feedback queue requires O_NOFOLLOW protection");
  return constants.O_NOFOLLOW;
}

export function resolveCanonicalFeedbackQueuePath(customRoot?: string, _useTodo = false): string {
  const root = customRoot || (isTestEnvironment() ? resolveScratchDir() : process.cwd());
  return require("path").join(root, ".olt", "backlog.jsonl");
}

export function resolveFeedbackQueuePath(customPath?: string): string {
  if (customPath && customPath.trim()) return require("path").resolve(customPath.trim());
  return require("path").join(process.cwd(), ".olt", "backlog.jsonl");
}

export function validateFeedbackResolutionProof(
  proof: unknown,
  options: {
    readonly requireCommitSha?: boolean | undefined;
    readonly requireTestPath?: boolean | undefined;
  } = {},
): FeedbackResolutionProof {
  if (typeof proof !== "object" || proof === null || Array.isArray(proof)) {
    throw new HarnessError("INVALID_ARGUMENT", "Feedback resolution proof must be an object");
  }

  const p = proof as Record<string, unknown>;
  const taskId = typeof p["task_id"] === "string" ? p["task_id"].trim() : "";
  if (!taskId) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Feedback resolution proof requires non-empty task_id",
    );
  }

  const resolvedAt =
    typeof p["resolved_at"] === "string" && p["resolved_at"].trim() ? p["resolved_at"].trim() : "";
  if (!resolvedAt) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Feedback resolution proof requires non-empty resolved_at",
    );
  }

  const parsedDate = Date.parse(resolvedAt);
  if (!Number.isFinite(parsedDate)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Feedback resolution proof resolved_at '${resolvedAt}' is not a valid ISO date timestamp`,
    );
  }

  const testPath =
    typeof p["test_path"] === "string" && p["test_path"].trim()
      ? p["test_path"].trim()
      : p["test_path"] === null
        ? null
        : undefined;
  if ("test_path" in p && p["test_path"] !== undefined && testPath === undefined) {
    throw new HarnessError("INVALID_ARGUMENT", "Feedback resolution proof has invalid test_path");
  }

  if (options.requireTestPath && (!testPath || testPath.length < 3)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Feedback resolution proof requires valid test_path when requireTestPath is enabled",
    );
  }

  const testAssertion =
    typeof p["test_assertion"] === "string" && p["test_assertion"].trim()
      ? p["test_assertion"].trim()
      : p["test_assertion"] === null
        ? null
        : undefined;
  if ("test_assertion" in p && p["test_assertion"] !== undefined && testAssertion === undefined) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Feedback resolution proof has invalid test_assertion",
    );
  }

  let assertions: number | string | readonly string[] | null | undefined = undefined;
  if (typeof p["assertions"] === "number" || typeof p["assertions"] === "string") {
    assertions = p["assertions"];
  } else if (Array.isArray(p["assertions"])) {
    assertions = p["assertions"].map((a) => String(a));
  } else if (p["assertions"] === null) {
    assertions = null;
  } else if ("assertions" in p && p["assertions"] !== undefined) {
    throw new HarnessError("INVALID_ARGUMENT", "Feedback resolution proof has invalid assertions");
  }

  let runtimeMs: number | string | null | undefined = undefined;
  if (typeof p["runtime_ms"] === "number" || typeof p["runtime_ms"] === "string") {
    runtimeMs = p["runtime_ms"];
  } else if (typeof p["runtime"] === "number" || typeof p["runtime"] === "string") {
    runtimeMs = p["runtime"] as number | string;
  } else if (p["runtime_ms"] === null || p["runtime"] === null) {
    runtimeMs = null;
  } else if (
    ("runtime_ms" in p && p["runtime_ms"] !== undefined) ||
    ("runtime" in p && p["runtime"] !== undefined)
  ) {
    throw new HarnessError("INVALID_ARGUMENT", "Feedback resolution proof has invalid runtime_ms");
  }

  const commitSha =
    typeof p["commit_sha"] === "string" && p["commit_sha"].trim()
      ? p["commit_sha"].trim()
      : p["commit_sha"] === null
        ? null
        : undefined;
  if ("commit_sha" in p && p["commit_sha"] !== undefined && commitSha === undefined) {
    throw new HarnessError("INVALID_ARGUMENT", "Feedback resolution proof has invalid commit_sha");
  }

  if (options.requireCommitSha && (!commitSha || commitSha.length < 7)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Feedback resolution proof requires valid commit_sha (>= 7 chars) when requireCommitSha is enabled",
    );
  }

  const proofSummary =
    typeof p["proof_summary"] === "string" && p["proof_summary"].trim()
      ? p["proof_summary"].trim()
      : p["proof_summary"] === null
        ? null
        : undefined;
  if ("proof_summary" in p && p["proof_summary"] !== undefined && proofSummary === undefined) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Feedback resolution proof has invalid proof_summary",
    );
  }

  const verifiedBy =
    typeof p["verified_by"] === "string" && p["verified_by"].trim()
      ? p["verified_by"].trim()
      : p["verified_by"] === null
        ? null
        : undefined;
  if ("verified_by" in p && p["verified_by"] !== undefined && verifiedBy === undefined) {
    throw new HarnessError("INVALID_ARGUMENT", "Feedback resolution proof has invalid verified_by");
  }

  const remediationNotes =
    typeof p["remediation_notes"] === "string" && p["remediation_notes"].trim()
      ? p["remediation_notes"].trim()
      : p["remediation_notes"] === null
        ? null
        : undefined;
  if (
    "remediation_notes" in p &&
    p["remediation_notes"] !== undefined &&
    remediationNotes === undefined
  ) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Feedback resolution proof has invalid remediation_notes",
    );
  }

  const metadata =
    typeof p["metadata"] === "object" && p["metadata"] !== null && !Array.isArray(p["metadata"])
      ? (p["metadata"] as Readonly<Record<string, unknown>>)
      : undefined;
  if ("metadata" in p && p["metadata"] !== undefined && metadata === undefined) {
    throw new HarnessError("INVALID_ARGUMENT", "Feedback resolution proof has invalid metadata");
  }

  return {
    task_id: taskId,
    resolved_at: resolvedAt,
    ...(testPath !== undefined ? { test_path: testPath } : {}),
    ...(testAssertion !== undefined ? { test_assertion: testAssertion } : {}),
    ...(assertions !== undefined ? { assertions } : {}),
    ...(runtimeMs !== undefined ? { runtime_ms: runtimeMs } : {}),
    ...(commitSha !== undefined ? { commit_sha: commitSha } : {}),
    ...(proofSummary !== undefined ? { proof_summary: proofSummary } : {}),
    ...(verifiedBy !== undefined ? { verified_by: verifiedBy } : {}),
    ...(remediationNotes !== undefined ? { remediation_notes: remediationNotes } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

export function verifyFeedbackEmpiricalSealing(
  proof: FeedbackResolutionProof,
  options: {
    readonly requireCommitSha?: boolean | undefined;
    readonly requireTestPath?: boolean | undefined;
  } = {},
): { readonly isValid: boolean; readonly reason?: string | undefined } {
  try {
    const validated = validateFeedbackResolutionProof(proof, options);
    if (!validated.task_id) {
      return { isValid: false, reason: "task_id is missing" };
    }
    if (options.requireTestPath && !validated.test_path) {
      return { isValid: false, reason: "test_path is missing" };
    }
    if (options.requireCommitSha && (!validated.commit_sha || validated.commit_sha.length < 7)) {
      return { isValid: false, reason: "commit_sha is missing or too short" };
    }
    return { isValid: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { isValid: false, reason: msg };
  }
}

function isOwnEnoent(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "code");
    return descriptor !== undefined && "value" in descriptor && descriptor.value === "ENOENT";
  } catch {
    return false;
  }
}

function strictFeedbackItem(parsed: unknown, lineNumber: number): FeedbackItem {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HarnessError("INTEGRITY", `feedback queue line ${lineNumber} is not an object`);
  }
  const record = parsed as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const timestamp = typeof record.timestamp === "string" ? record.timestamp.trim() : "";
  const title = typeof record.title === "string" ? record.title : "";
  const content = typeof record.content === "string" ? record.content : "";
  if (!id || !timestamp || !Number.isFinite(Date.parse(timestamp)) || !title || !content) {
    throw new HarnessError("INTEGRITY", `feedback queue line ${lineNumber} is malformed`);
  }
  const priority = validatePriority(record.priority);
  const status = validateStatus(record.status);
  const category = validateCategory(record.category);
  for (const key of [
    "candidate_id",
    "resolution_note",
    "processed_at",
    "test_path",
    "commit_sha",
  ]) {
    if (
      key in record &&
      record[key] !== undefined &&
      record[key] !== null &&
      typeof record[key] !== "string"
    )
      throw new HarnessError("INTEGRITY", `feedback queue line ${lineNumber} has invalid ${key}`);
  }
  if (
    "processed_at" in record &&
    typeof record.processed_at === "string" &&
    !Number.isFinite(Date.parse(record.processed_at))
  ) {
    throw new HarnessError(
      "INTEGRITY",
      `feedback queue line ${lineNumber} has invalid processed_at`,
    );
  }
  if ("resolution" in record && record.resolution !== null)
    validateFeedbackResolutionProof(record.resolution);
  if (
    "metadata" in record &&
    record.metadata !== undefined &&
    (typeof record.metadata !== "object" ||
      record.metadata === null ||
      Array.isArray(record.metadata))
  ) {
    throw new HarnessError("INTEGRITY", `feedback queue line ${lineNumber} has invalid metadata`);
  }
  const normalized: FeedbackItem = {
    ...(record as unknown as FeedbackItem),
    id,
    timestamp,
    priority,
    status,
    category,
    title,
    content,
  };
  return normalized;
}

/** Strict evidence reader for lifecycle decisions; diagnostic consumers keep readFeedbackQueue. */
export function readFeedbackQueueStrict(customPath?: string): FeedbackItem[] {
  const filePath = resolveFeedbackQueuePath(customPath);
  return parseFeedbackQueue(readFeedbackQueueFile(filePath));
}

/** Strict reader retained as the default public diagnostic reader: invalid bytes are never skipped. */
export function readFeedbackQueue(customPath?: string): FeedbackItem[] {
  return readFeedbackQueueStrict(customPath);
}

function readFeedbackQueueFile(filePath: string): string {
  let descriptor: number | undefined;
  try {
    const before = lstatSync(filePath);
    if (!before.isFile() || before.nlink !== 1)
      throw new HarnessError("INTEGRITY", "feedback queue must be a single-link regular file");
    descriptor = openSync(filePath, constants.O_RDONLY | noFollowFlag());
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino
    )
      throw new HarnessError("INTEGRITY", "feedback queue changed while being opened");
    const raw = readFileSync(descriptor, "utf8");
    const after = lstatSync(filePath);
    if (
      !after.isFile() ||
      after.nlink !== 1 ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino
    )
      throw new HarnessError("INTEGRITY", "feedback queue changed while being read");
    return raw;
  } catch (error) {
    if (isOwnEnoent(error)) return "";
    if (error instanceof HarnessError) throw error;
    throw new HarnessError("INTEGRITY", `feedback queue cannot be securely read: ${filePath}`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function parseFeedbackQueue(raw: string): FeedbackItem[] {
  const items: FeedbackItem[] = [];
  const ids = new Set<string>();
  for (const [index, line] of raw.split("\n").entries()) {
    if (!line.trim()) continue;
    try {
      const item = strictFeedbackItem(JSON.parse(line), index + 1);
      if (ids.has(item.id))
        throw new HarnessError(
          "INTEGRITY",
          `feedback queue line ${index + 1} duplicates id '${item.id}'`,
        );
      ids.add(item.id);
      items.push(item);
    } catch (error) {
      if (error instanceof HarnessError) throw error;
      throw new HarnessError("INTEGRITY", `feedback queue line ${index + 1} is malformed`);
    }
  }
  return sortFeedbackByPriority(items);
}

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

function acquireFeedbackQueueFlock(descriptor: number, label: string): void {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (tryExclusiveFlock(descriptor)) return;
    Atomics.wait(feedbackQueueLockSleep, 0, 0, 5);
  }
  throw new HarnessError("LOCK_TIMEOUT", `${label} is already locked`);
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
    acquireFeedbackQueueFlock(rootFd, "feedback queue root");
    rootLocked = true;
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
    acquireFeedbackQueueFlock(parentFd, "feedback queue parent");
    parentLocked = true;
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
  if (parentLocked && parentFd !== undefined) tryCleanup(() => releaseFlock(parentFd!));
  if (rootLocked && rootFd !== undefined) tryCleanup(() => releaseFlock(rootFd!));
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

export function clearFeedbackQueue(customPath?: string): void {
  withFeedbackQueueTransaction(customPath, () => ({ items: [], result: undefined }));
}

export function appendFeedbackItem(
  item: Omit<FeedbackItem, "timestamp"> & { timestamp?: string },
  customPath?: string,
): FeedbackItem {
  return withFeedbackQueueTransaction(customPath, (existing) => {
    if (existing.some((entry) => entry.id === item.id))
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `Feedback item with id '${item.id}' already exists in the queue`,
      );
    const newItem: FeedbackItem = {
      ...item,
      timestamp: item.timestamp ?? new Date().toISOString(),
    };
    return { items: [...existing, newItem], result: newItem };
  });
}

/** Appends items atomically, skipping titles already present or duplicated in the supplied batch. */
export function appendFeedbackItemsDedupedByTitle(
  items: readonly (Omit<FeedbackItem, "timestamp"> & { readonly timestamp?: string | undefined })[],
  customPath?: string,
): readonly FeedbackItem[] {
  return withFeedbackQueueTransaction(customPath, (existing) => {
    const titles = new Set(existing.map((item) => item.title.trim().toLowerCase()));
    const ids = new Set(existing.map((item) => item.id));
    const appended: FeedbackItem[] = [];
    for (const input of items) {
      const title = input.title.trim().toLowerCase();
      if (titles.has(title)) continue;
      if (ids.has(input.id))
        throw new HarnessError(
          "INTEGRITY",
          `Feedback item with id '${input.id}' already exists in the queue`,
        );
      const item: FeedbackItem = {
        ...input,
        timestamp: input.timestamp ?? new Date().toISOString(),
      };
      titles.add(title);
      ids.add(item.id);
      appended.push(item);
    }
    return { items: [...existing, ...appended], result: appended };
  });
}

/** Predicate-scoped atomic update/prune primitive for callers that must avoid whole-ledger RMW. */
export function updateOrPruneFeedbackItems<T>(
  mutation: (item: FeedbackItem) => FeedbackItem | null,
  customPath?: string,
  result?: (items: readonly FeedbackItem[]) => T,
): T | readonly FeedbackItem[] {
  return withFeedbackQueueTransaction(customPath, (existing) => {
    const next = existing.flatMap((item) => {
      const updated = mutation(item);
      return updated === null ? [] : [updated];
    });
    return { items: next, result: result ? result(next) : next };
  });
}

export function ingestFeedbackItem(
  input: {
    readonly id?: string | undefined;
    readonly title: string;
    readonly content: string;
    readonly priority?: FeedbackPriority | undefined;
    readonly category?: FeedbackCategory | undefined;
    readonly candidate_id?: string | null | undefined;
    readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  },
  customPath?: string,
): FeedbackItem {
  const generatedId = input.id ?? `fb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return appendFeedbackItem(
    {
      id: generatedId,
      title: input.title,
      content: input.content,
      priority: input.priority ?? "NORMAL",
      category: input.category ?? "GENERAL",
      status: "PENDING",
      candidate_id: input.candidate_id ?? null,
      metadata: input.metadata,
    },
    customPath,
  );
}

export function admitFeedbackToQueue(
  idOrItem:
    | string
    | (Omit<FeedbackItem, "timestamp" | "status"> & {
        readonly timestamp?: string | undefined;
        readonly status?: FeedbackStatus | undefined;
      }),
  customPath?: string,
): FeedbackItem {
  if (typeof idOrItem === "string") {
    return withFeedbackQueueTransaction(customPath, (existing) => {
      const index = existing.findIndex((entry) => entry.id === idOrItem);
      if (index === -1)
        throw new HarnessError(
          "INVALID_STATE",
          `Feedback item with id '${idOrItem}' not found in queue`,
        );
      const updatedItem = {
        ...existing[index]!,
        status: "ADMITTED" as const,
        processed_at: existing[index]!.processed_at ?? new Date().toISOString(),
      };
      const items = [...existing];
      items[index] = updatedItem;
      return { items, result: updatedItem };
    });
  }
  return withFeedbackQueueTransaction(customPath, (existing) => {
    const index = existing.findIndex((entry) => entry.id === idOrItem.id);
    const now = new Date().toISOString();
    if (index !== -1) {
      const current = existing[index]!;
      const updatedItem: FeedbackItem = {
        ...current,
        ...idOrItem,
        timestamp: idOrItem.timestamp ?? current.timestamp,
        status: idOrItem.status ?? "ADMITTED",
        processed_at: current.processed_at ?? now,
      };
      const items = [...existing];
      items[index] = updatedItem;
      return { items, result: updatedItem };
    }
    const newItem: FeedbackItem = {
      ...idOrItem,
      status: idOrItem.status ?? "ADMITTED",
      timestamp: idOrItem.timestamp ?? now,
      processed_at: now,
    };
    return { items: [...existing, newItem], result: newItem };
  });
}

export function updateFeedbackItem(
  id: string,
  update: Partial<FeedbackItem>,
  customPath?: string,
): FeedbackItem {
  return withFeedbackQueueTransaction(customPath, (existing) => {
    const index = existing.findIndex((entry) => entry.id === id);
    if (index === -1)
      throw new HarnessError("INVALID_STATE", `Feedback item with id '${id}' not found in queue`);
    const current = existing[index]!;
    const updatedItem: FeedbackItem = {
      ...current,
      ...update,
      id: current.id,
      timestamp: current.timestamp,
    };
    const items = [...existing];
    items[index] = updatedItem;
    return { items, result: updatedItem };
  });
}

export function sealFeedbackResolution(
  idOrTaskId: string,
  proof: FeedbackResolutionProof,
  options?: {
    readonly customPath?: string | undefined;
    readonly requireCommitSha?: boolean | undefined;
    readonly requireTestPath?: boolean | undefined;
  },
): FeedbackItem {
  const validatedProof = validateFeedbackResolutionProof(proof, {
    requireCommitSha: options?.requireCommitSha,
    requireTestPath: options?.requireTestPath,
  });
  return withFeedbackQueueTransaction(options?.customPath, (existing) => {
    const index = existing.findIndex(
      (entry) => entry.id === idOrTaskId || entry.candidate_id === idOrTaskId,
    );
    if (index === -1)
      throw new HarnessError(
        "INVALID_STATE",
        `Feedback item matching id or candidate_id '${idOrTaskId}' not found in queue`,
      );
    const current = existing[index]!;
    const proofSummary =
      validatedProof.proof_summary ??
      validatedProof.test_assertion ??
      current.resolution_note ??
      `Empirically resolved by ${validatedProof.task_id}`;
    const updatedItem: FeedbackItem = {
      ...current,
      status: "COMPLETED",
      processed_at: validatedProof.resolved_at,
      resolution_note: proofSummary,
      resolution: validatedProof,
      ...(validatedProof.test_path !== undefined && validatedProof.test_path !== null
        ? { test_path: validatedProof.test_path }
        : current.test_path !== undefined
          ? { test_path: current.test_path }
          : {}),
      ...(validatedProof.assertions !== undefined && validatedProof.assertions !== null
        ? { assertions: validatedProof.assertions }
        : current.assertions !== undefined
          ? { assertions: current.assertions }
          : {}),
      ...(validatedProof.runtime_ms !== undefined && validatedProof.runtime_ms !== null
        ? { runtime_ms: validatedProof.runtime_ms }
        : current.runtime_ms !== undefined
          ? { runtime_ms: current.runtime_ms }
          : {}),
      ...(validatedProof.commit_sha !== undefined && validatedProof.commit_sha !== null
        ? { commit_sha: validatedProof.commit_sha }
        : current.commit_sha !== undefined
          ? { commit_sha: current.commit_sha }
          : {}),
    };
    const items = [...existing];
    items[index] = updatedItem;
    return { items, result: updatedItem };
  });
}

export function backpropagateFeedbackResolution(
  records: readonly BackpropagationRecord[],
  customPath?: string,
): FeedbackItem[] {
  if (records.length === 0) {
    return [];
  }
  const taskMap = new Map<string, BackpropagationRecord>();
  for (const r of records) {
    taskMap.set(r.id, r);
  }

  return withFeedbackQueueTransaction(customPath, (existing) => {
    const updatedItems: FeedbackItem[] = [];
    const nextList: FeedbackItem[] = [];
    for (const item of existing) {
      const matchedRecord =
        taskMap.get(item.id) ?? (item.candidate_id ? taskMap.get(item.candidate_id) : undefined);
      if (matchedRecord) {
        const resolvedAt = matchedRecord.completed_at || new Date().toISOString();
        const testPath =
          matchedRecord.test_path ??
          (matchedRecord.metadata?.["test_path"] as string | undefined) ??
          item.test_path;
        const assertions =
          matchedRecord.assertions ??
          (matchedRecord.metadata?.["assertions"] as
            | number
            | string
            | readonly string[]
            | undefined) ??
          (matchedRecord.metadata?.["test_assertions"] as
            | number
            | string
            | readonly string[]
            | undefined) ??
          item.assertions;
        const runtimeMs =
          matchedRecord.runtime_ms ??
          (matchedRecord.metadata?.["runtime_ms"] as number | string | undefined) ??
          (matchedRecord.metadata?.["runtime"] as number | string | undefined) ??
          item.runtime_ms;
        const commitSha =
          matchedRecord.commit_sha ??
          (matchedRecord.metadata?.["commit_sha"] as string | undefined) ??
          item.commit_sha;
        const proofSummary =
          matchedRecord.proof_summary ??
          item.resolution_note ??
          `Resolved by task ${matchedRecord.id}`;

        let proof: FeedbackResolutionProof;
        if (matchedRecord.resolution) {
          proof = validateFeedbackResolutionProof({
            ...matchedRecord.resolution,
            task_id: matchedRecord.resolution.task_id || matchedRecord.id,
            resolved_at: matchedRecord.resolution.resolved_at || resolvedAt,
          });
        } else {
          proof = {
            task_id: matchedRecord.id,
            resolved_at: resolvedAt,
            ...(testPath ? { test_path: testPath } : {}),
            ...(assertions !== undefined && assertions !== null ? { assertions } : {}),
            ...(runtimeMs !== undefined && runtimeMs !== null ? { runtime_ms: runtimeMs } : {}),
            ...(commitSha ? { commit_sha: commitSha } : {}),
            ...(proofSummary ? { proof_summary: proofSummary, test_assertion: proofSummary } : {}),
          };
        }

        const updated: FeedbackItem = {
          ...item,
          status: "COMPLETED",
          processed_at: resolvedAt,
          resolution_note: proofSummary,
          resolution: proof,
          ...(testPath !== undefined && testPath !== null ? { test_path: testPath } : {}),
          ...(assertions !== undefined && assertions !== null ? { assertions } : {}),
          ...(runtimeMs !== undefined && runtimeMs !== null ? { runtime_ms: runtimeMs } : {}),
          ...(commitSha !== undefined && commitSha !== null ? { commit_sha: commitSha } : {}),
        };

        updatedItems.push(updated);
        nextList.push(updated);
      } else {
        nextList.push(item);
      }
    }
    return { items: nextList, result: updatedItems };
  });
}

export function drainPendingFeedbacks(
  options: {
    readonly markAs?: FeedbackStatus | undefined;
    readonly limit?: number | undefined;
    readonly category?: FeedbackCategory | undefined;
    readonly filter?: ((item: FeedbackItem) => boolean) | undefined;
  } = {},
  customPath?: string,
): FeedbackItem[] {
  const markAs = options.markAs !== undefined ? options.markAs : "PROCESSED";
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  const nowIso = new Date().toISOString();

  return withFeedbackQueueTransaction(customPath, (existing) => {
    const selected: FeedbackItem[] = [];
    const updatedList: FeedbackItem[] = [];
    for (const item of existing) {
      const matchesCategory = !options.category || item.category === options.category;
      const matchesCustom = !options.filter || options.filter(item);
      if (
        item.status === "PENDING" &&
        matchesCategory &&
        matchesCustom &&
        selected.length < limit
      ) {
        const processed: FeedbackItem = {
          ...item,
          status: markAs,
          processed_at: nowIso,
        };
        selected.push(processed);
        updatedList.push(processed);
      } else {
        updatedList.push(item);
      }
    }
    return { items: updatedList, result: selected };
  });
}

export function compareFeedbackPriority(
  a: FeedbackItem | FeedbackPriority,
  b: FeedbackItem | FeedbackPriority,
): number {
  const priorityA = typeof a === "string" ? a : a.priority;
  const priorityB = typeof b === "string" ? b : b.priority;
  const rankA = PRIORITY_ORDER[priorityA] ?? 99;
  const rankB = PRIORITY_ORDER[priorityB] ?? 99;
  if (rankA !== rankB) {
    return rankA - rankB;
  }
  if (typeof a !== "string" && typeof b !== "string") {
    return a.timestamp.localeCompare(b.timestamp);
  }
  return 0;
}

export function sortFeedbackByPriority(items: readonly FeedbackItem[]): FeedbackItem[] {
  return [...items].sort((a, b) => compareFeedbackPriority(a, b));
}

export function getFeedbackStats(items: readonly FeedbackItem[]): FeedbackQueueStats {
  let pending = 0;
  let admitted = 0;
  let declined = 0;
  let processed = 0;
  let completed = 0;

  for (const item of items) {
    switch (item.status) {
      case "PENDING":
        pending += 1;
        break;
      case "ADMITTED":
        admitted += 1;
        break;
      case "DECLINED":
        declined += 1;
        break;
      case "PROCESSED":
        processed += 1;
        break;
      case "COMPLETED":
        completed += 1;
        break;
    }
  }

  return {
    total: items.length,
    pending,
    admitted,
    declined,
    processed,
    completed,
  };
}

function validatePriority(val: unknown): FeedbackPriority {
  if (typeof val === "string") {
    const upper = val.toUpperCase();
    if (upper === "CRITICAL_USER_FEEDBACK" || upper === "CRITICAL") return "CRITICAL_USER_FEEDBACK";
    if (upper === "HIGH_ARCHITECTURAL_FEATURE" || upper === "HIGH")
      return "HIGH_ARCHITECTURAL_FEATURE";
    if (upper === "USER_DIRECTIVE" || upper === "DIRECTIVE") return "USER_DIRECTIVE";
    if (upper === "NORMAL" || upper === "MEDIUM") return "NORMAL";
    if (upper === "LOW") return "LOW";
  }
  throw new HarnessError("INTEGRITY", "Feedback item requires valid priority");
}

function validateStatus(val: unknown): FeedbackStatus {
  if (typeof val === "string") {
    const upper = val.toUpperCase();
    if (upper === "PENDING") return "PENDING";
    if (upper === "ADMITTED") return "ADMITTED";
    if (upper === "DECLINED") return "DECLINED";
    if (upper === "PROCESSED") return "PROCESSED";
    if (upper === "COMPLETED") return "COMPLETED";
  }
  throw new HarnessError("INTEGRITY", "Feedback item requires valid status");
}

function validateCategory(val: unknown): FeedbackCategory {
  if (typeof val === "string") {
    const upper = val.toUpperCase();
    if (upper === "DOCUMENTATION") return "DOCUMENTATION";
    if (upper === "AGENT_CONTRACTS") return "AGENT_CONTRACTS";
    if (upper === "CLI_TOOLING") return "CLI_TOOLING";
    if (upper === "WATCHDOG") return "WATCHDOG";
    if (upper === "SCALING") return "SCALING";
    if (upper === "ARCHITECTURE") return "ARCHITECTURE";
    if (upper === "CORE_ENGINE") return "CORE_ENGINE";
    if (upper === "REPAIR") return "REPAIR";
    if (upper === "GENERAL") return "GENERAL";
  }
  throw new HarnessError("INTEGRITY", "Feedback item requires valid category");
}

/**
 * Atomically admits a feedback item and dispatches it to a task node.
 * Ensures the atomic admission-to-dispatch invariant: no item is paused in ADMITTED state
 * without an associated task node. If the dispatcher fails, the feedback queue is not modified.
 */
export function admitAndDispatchFeedbackAtomically(
  idOrItem:
    | string
    | (Omit<FeedbackItem, "timestamp" | "status"> & {
        readonly timestamp?: string | undefined;
        readonly status?: FeedbackStatus | undefined;
      }),
  dispatcher: (item: FeedbackItem) => {
    readonly taskId: string;
    readonly autoEnqueued?: boolean | undefined;
    readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  },
  customPath?: string,
): AtomicAdmissionDispatchResult {
  return withFeedbackQueueTransaction(customPath, (existing) => {
    const nowIso = new Date().toISOString();

    let targetItem: FeedbackItem;
    let targetIndex = -1;

    if (typeof idOrItem === "string") {
      targetIndex = existing.findIndex((e) => e.id === idOrItem);
      if (targetIndex === -1) {
        throw new HarnessError(
          "INVALID_STATE",
          `Feedback item with id '${idOrItem}' not found in queue`,
        );
      }
      targetItem = existing[targetIndex]!;
    } else {
      targetIndex = existing.findIndex((e) => e.id === idOrItem.id);
      if (targetIndex !== -1) {
        targetItem = {
          ...existing[targetIndex]!,
          ...idOrItem,
          status: idOrItem.status ?? existing[targetIndex]!.status,
          timestamp: idOrItem.timestamp ?? existing[targetIndex]!.timestamp,
        };
      } else {
        const initialStatus: FeedbackStatus =
          idOrItem.status !== undefined ? idOrItem.status : "PENDING";
        targetItem = {
          ...idOrItem,
          status: initialStatus,
          timestamp: idOrItem.timestamp ?? nowIso,
        };
      }
    }

    // Execute dispatcher callback atomically BEFORE persisting the ADMITTED state
    const dispatchRes = dispatcher(targetItem);
    if (!dispatchRes.taskId || !dispatchRes.taskId.trim()) {
      throw new HarnessError(
        "INTEGRITY",
        "Atomic admission-to-dispatch failure: dispatcher did not return a valid taskId",
      );
    }

    const updatedMetadata: Record<string, unknown> = {
      ...(targetItem.metadata ?? {}),
      ...(dispatchRes.metadata ?? {}),
      dispatched_task_id: dispatchRes.taskId.trim(),
      atomic_dispatched_at: nowIso,
    };

    const admittedItem: FeedbackItem = {
      ...targetItem,
      status: "ADMITTED",
      processed_at: nowIso,
      metadata: updatedMetadata,
    };

    const updatedList = [...existing];
    if (targetIndex !== -1) {
      updatedList[targetIndex] = admittedItem;
    } else {
      updatedList.push(admittedItem);
    }

    return {
      items: updatedList,
      result: {
        feedback_item: admittedItem,
        dispatched_task_id: dispatchRes.taskId.trim(),
        admitted_at: nowIso,
        auto_enqueued: dispatchRes.autoEnqueued ?? true,
      },
    };
  });
}

/**
 * Audits the atomic admission-to-dispatch integrity across feedback and task queues.
 * Verifies that zero admitted items are left in a paused or orphaned state.
 */
export function auditAdmissionDispatchIntegrity(
  options: {
    readonly feedbackPath?: string | undefined;
    readonly taskQueuePath?: string | undefined;
  } = {},
): AdmissionDispatchIntegrityReport {
  const feedbacks = readFeedbackQueue(options.feedbackPath);
  const admittedFeedbacks = feedbacks.filter((f) => f.status === "ADMITTED");

  // Read task queue
  const taskQueueFilePath = resolveTaskQueuePath(options.taskQueuePath);
  interface ParsedTaskInfo {
    readonly id: string;
    readonly status: string;
    readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  }
  const taskItems: ParsedTaskInfo[] = [];

  if (existsSync(taskQueueFilePath)) {
    try {
      const raw = readFileSync(taskQueueFilePath, "utf8");
      const lines = raw
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          if (parsed && typeof parsed["id"] === "string") {
            taskItems.push({
              id: parsed["id"],
              status: typeof parsed["status"] === "string" ? parsed["status"] : "PENDING",
              metadata:
                typeof parsed["metadata"] === "object" && parsed["metadata"] !== null
                  ? (parsed["metadata"] as Readonly<Record<string, unknown>>)
                  : undefined,
            });
          }
        } catch {
          // skip
        }
      }
    } catch {
      // skip
    }
  }

  const taskMap = new Map<string, ParsedTaskInfo>();
  const feedbackIdToTaskMap = new Map<string, ParsedTaskInfo>();
  for (const t of taskItems) {
    taskMap.set(t.id, t);
    const fbId = t.metadata?.["feedback_id"] ?? t.metadata?.["batched_feedback_ids"];
    if (typeof fbId === "string") {
      feedbackIdToTaskMap.set(fbId, t);
    }
  }

  const violations: string[] = [];
  const pausedAdmitted: FeedbackItem[] = [];
  let activeDispatchedCount = 0;

  for (const fb of admittedFeedbacks) {
    const dispatchedTaskId = fb.metadata?.["dispatched_task_id"];
    const matchedByMeta =
      typeof dispatchedTaskId === "string" ? taskMap.get(dispatchedTaskId) : undefined;
    const matchedByFbId = feedbackIdToTaskMap.get(fb.id);
    const matchedTask = matchedByMeta ?? matchedByFbId;

    if (!matchedTask) {
      violations.push(
        `Admitted feedback item '${fb.id}' (${fb.title}) is paused without an enqueued/dispatched task node.`,
      );
      pausedAdmitted.push(fb);
    } else {
      activeDispatchedCount++;
    }
  }

  return {
    is_compliant: violations.length === 0,
    total_feedback_items: feedbacks.length,
    admitted_feedback_count: admittedFeedbacks.length,
    paused_admitted_feedback_count: pausedAdmitted.length,
    paused_admitted_feedbacks: pausedAdmitted,
    active_dispatched_feedback_count: activeDispatchedCount,
    violations,
  };
}

/**
 * Reconciles paused or orphaned admitted feedbacks by resetting status to PENDING or returning report.
 */
export function reconcilePausedAdmittedFeedbacks(
  options: {
    readonly feedbackPath?: string | undefined;
    readonly taskQueuePath?: string | undefined;
    readonly resetToPending?: boolean | undefined;
  } = {},
): {
  readonly reconciled_count: number;
  readonly remediated_feedbacks: readonly FeedbackItem[];
} {
  const audit = auditAdmissionDispatchIntegrity(options);
  if (audit.paused_admitted_feedback_count === 0) {
    return {
      reconciled_count: 0,
      remediated_feedbacks: [],
    };
  }

  const pausedIds = new Set(audit.paused_admitted_feedbacks.map((f) => f.id));
  return withFeedbackQueueTransaction(options.feedbackPath, (existing) => {
    const remediated: FeedbackItem[] = [];
    const items = existing.map((item) => {
      if (!pausedIds.has(item.id)) return item;
      const updated: FeedbackItem = {
        ...item,
        status: options.resetToPending ? "PENDING" : "ADMITTED",
        processed_at: null,
      };
      remediated.push(updated);
      return updated;
    });
    return {
      items,
      result: { reconciled_count: remediated.length, remediated_feedbacks: remediated },
    };
  });
}

export function migrateFeedbackQueue(options: { sourcePath: string; targetPath?: string }): {
  migrated: boolean;
  count: number;
} {
  const target = resolveFeedbackQueuePath(options.targetPath);
  if (!existsSync(options.sourcePath) || options.sourcePath === target) {
    return { migrated: false, count: 0 };
  }
  const records = readFeedbackQueue(options.sourcePath);
  if (records.length === 0) {
    return { migrated: false, count: 0 };
  }
  return withFeedbackQueueTransaction(target, (existing) => {
    const map = new Map<string, FeedbackItem>();
    for (const item of existing) map.set(item.id, item);
    for (const item of records) map.set(item.id, item);
    return { items: Array.from(map.values()), result: { migrated: true, count: records.length } };
  });
}
