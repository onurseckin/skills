import {
  existsSync,
  readFileSync,
  statSync,
  lstatSync,
  fstatSync,
  openSync,
  closeSync,
  constants,
} from "node:fs";
import { HarnessError } from "../../../core/errors/index.ts";
import type { FeedbackItem, FeedbackResolutionProof } from "./types.ts";
import {
  resolveFeedbackQueuePath,
  DEFAULT_FEEDBACK_FILE,
  noFollowFlag,
  sortFeedbackByPriority,
  validatePriority,
  validateStatus,
  validateCategory,
} from "./types.ts";
import { validateFeedbackResolutionProof } from "./storage.ts";
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

export function isOwnEnoent(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "code");
    return descriptor !== undefined && "value" in descriptor && descriptor.value === "ENOENT";
  } catch {
    return false;
  }
}

export function strictFeedbackItem(parsed: unknown, lineNumber: number): FeedbackItem {
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

export function readFeedbackQueueFile(filePath: string): string {
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

export function parseFeedbackQueue(raw: string): FeedbackItem[] {
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
