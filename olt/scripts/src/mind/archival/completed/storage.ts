import type {
  CompletedTaskSource,
  CompletedTaskStatus,
  CompletedTaskRecord,
  CompletedTasksStats,
  RecordCompletedTaskOptions,
  LedgerPersistenceStage,
} from "./types.ts";
import {
  CANONICAL_COMPLETED_TASKS_FILE,
  DEFAULT_COMPLETED_TASKS_FILE,
  CANONICAL_DEFECTS_FILE,
  DEFAULT_DEFECTS_FILE,
  CANONICAL_COMPLETED_DEFECTS_FILE,
  DEFAULT_COMPLETED_DEFECTS_FILE,
  CANONICAL_OBSERVATIONS_FILE,
  DEFAULT_OBSERVATIONS_FILE,
  ledgerPersistenceTestHook,
  __setCompletedTasksPersistenceTestHook,
  invokeLedgerPersistenceHook,
  resolveCanonicalCompletedTasksPath,
  resolveCompletedTasksLedgerPath,
  resolveCanonicalDefectsPath,
  resolveDefectsPath,
  resolveCanonicalCompletedDefectsPath,
  resolveCompletedDefectsPath,
  resolveCanonicalObservationsPath,
  resolveObservationsPath,
  isOwnCode,
  readLedgerFile,
  withLedgerTransaction,
} from "./types.ts";
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

export function atomicWriteLedger(filePath: string, raw: string): void {
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
