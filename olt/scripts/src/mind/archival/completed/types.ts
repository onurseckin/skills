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
import { enforceLineLimit, formatTable } from "../../../cli/formatters/line-limiter.ts";
import { nextActionsBlock } from "../../../cli/formatters/next-actions.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import { pruneDefectLedgerRecords } from "../../../logging/defect-logger.ts";
import { releaseFlock, tryExclusiveFlock } from "../../../platform/index.ts";
import { isTestEnvironment, resolveScratchDir } from "../../../core/shared/paths.ts";
import {
  resolveFeedbackQueuePath,
  updateOrPruneFeedbackItems,
  validateFeedbackResolutionProof,
  type FeedbackResolutionProof,
} from "../../feedback/queue/index.ts";

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

export type LedgerPersistenceStage =
  | "before_write"
  | "before_file_fsync"
  | "before_rename"
  | "after_rename"
  | "before_directory_fsync";

export let ledgerPersistenceTestHook: ((stage: LedgerPersistenceStage) => void) | undefined;

/** @internal deterministic persistence seam for the unit suite. */
export function __setCompletedTasksPersistenceTestHook(
  hook: ((stage: LedgerPersistenceStage) => void) | undefined,
): void {
  ledgerPersistenceTestHook = hook;
}

export function invokeLedgerPersistenceHook(stage: LedgerPersistenceStage): void {
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

export function isOwnCode(error: unknown, code: string): boolean {
  if (!(error instanceof Error)) return false;
  return Object.getOwnPropertyDescriptor(error, "code")?.value === code;
}

export function readLedgerFile(filePath: string): string | undefined {
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

export function withLedgerTransaction<T>(filePath: string, mutation: () => T): T {
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
