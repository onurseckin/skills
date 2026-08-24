import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { HarnessError } from "../core/errors/harness-error.ts";
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

export function resolveCanonicalFeedbackQueuePath(customRoot?: string, _useTodo = false): string {
  return require("path").join(customRoot || process.cwd(), ".olt", "backlog.jsonl");
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
    typeof p["resolved_at"] === "string" && p["resolved_at"].trim()
      ? p["resolved_at"].trim()
      : new Date().toISOString();

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

  let assertions: number | string | readonly string[] | null | undefined = undefined;
  if (typeof p["assertions"] === "number" || typeof p["assertions"] === "string") {
    assertions = p["assertions"];
  } else if (Array.isArray(p["assertions"])) {
    assertions = p["assertions"].map((a) => String(a));
  } else if (p["assertions"] === null) {
    assertions = null;
  }

  let runtimeMs: number | string | null | undefined = undefined;
  if (typeof p["runtime_ms"] === "number" || typeof p["runtime_ms"] === "string") {
    runtimeMs = p["runtime_ms"];
  } else if (typeof p["runtime"] === "number" || typeof p["runtime"] === "string") {
    runtimeMs = p["runtime"] as number | string;
  } else if (p["runtime_ms"] === null || p["runtime"] === null) {
    runtimeMs = null;
  }

  const commitSha =
    typeof p["commit_sha"] === "string" && p["commit_sha"].trim()
      ? p["commit_sha"].trim()
      : p["commit_sha"] === null
        ? null
        : undefined;

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

  const verifiedBy =
    typeof p["verified_by"] === "string" && p["verified_by"].trim()
      ? p["verified_by"].trim()
      : p["verified_by"] === null
        ? null
        : undefined;

  const remediationNotes =
    typeof p["remediation_notes"] === "string" && p["remediation_notes"].trim()
      ? p["remediation_notes"].trim()
      : p["remediation_notes"] === null
        ? null
        : undefined;

  const metadata =
    typeof p["metadata"] === "object" && p["metadata"] !== null && !Array.isArray(p["metadata"])
      ? (p["metadata"] as Readonly<Record<string, unknown>>)
      : undefined;

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

export function readFeedbackQueue(customPath?: string): FeedbackItem[] {
  const filePath = resolveFeedbackQueuePath(customPath);
  if (!existsSync(filePath)) {
    return [];
  }

  const raw = readFileSync(filePath, "utf8");
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const items: FeedbackItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (!parsed["id"] || typeof parsed["id"] !== "string") {
        continue;
      }

      let resolution: FeedbackResolutionProof | null | undefined = undefined;
      if (
        typeof parsed["resolution"] === "object" &&
        parsed["resolution"] !== null &&
        !Array.isArray(parsed["resolution"])
      ) {
        try {
          resolution = validateFeedbackResolutionProof(parsed["resolution"]);
        } catch {
          resolution = undefined;
        }
      } else if (parsed["resolution"] === null) {
        resolution = null;
      }

      let assertions: number | string | readonly string[] | null | undefined = undefined;
      if (typeof parsed["assertions"] === "number" || typeof parsed["assertions"] === "string") {
        assertions = parsed["assertions"];
      } else if (Array.isArray(parsed["assertions"])) {
        assertions = parsed["assertions"].map((a) => String(a));
      } else if (parsed["assertions"] === null) {
        assertions = null;
      }

      let runtimeMs: number | string | null | undefined = undefined;
      if (typeof parsed["runtime_ms"] === "number" || typeof parsed["runtime_ms"] === "string") {
        runtimeMs = parsed["runtime_ms"];
      } else if (typeof parsed["runtime"] === "number" || typeof parsed["runtime"] === "string") {
        runtimeMs = parsed["runtime"] as number | string;
      } else if (parsed["runtime_ms"] === null || parsed["runtime"] === null) {
        runtimeMs = null;
      }

      const item: FeedbackItem = {
        id: String(parsed["id"]),
        timestamp:
          typeof parsed["timestamp"] === "string" ? parsed["timestamp"] : new Date().toISOString(),
        priority: validatePriority(parsed["priority"]),
        status: validateStatus(parsed["status"]),
        category: validateCategory(parsed["category"]),
        title: typeof parsed["title"] === "string" ? parsed["title"] : `Feedback ${parsed["id"]}`,
        content: typeof parsed["content"] === "string" ? parsed["content"] : "",
        candidate_id: typeof parsed["candidate_id"] === "string" ? parsed["candidate_id"] : null,
        resolution_note:
          typeof parsed["resolution_note"] === "string" ? parsed["resolution_note"] : null,
        processed_at: typeof parsed["processed_at"] === "string" ? parsed["processed_at"] : null,
        ...(resolution !== undefined ? { resolution } : {}),
        ...(typeof parsed["test_path"] === "string" ? { test_path: parsed["test_path"] } : {}),
        ...(assertions !== undefined ? { assertions } : {}),
        ...(runtimeMs !== undefined ? { runtime_ms: runtimeMs } : {}),
        ...(typeof parsed["commit_sha"] === "string" ? { commit_sha: parsed["commit_sha"] } : {}),
        metadata:
          typeof parsed["metadata"] === "object" &&
          parsed["metadata"] !== null &&
          !Array.isArray(parsed["metadata"])
            ? (parsed["metadata"] as Record<string, unknown>)
            : undefined,
      };
      items.push(item);
    } catch {
      // Skip malformed individual line in log
    }
  }

  return sortFeedbackByPriority(items);
}

export function writeFeedbackQueue(items: readonly FeedbackItem[], customPath?: string): void {
  const filePath = resolveFeedbackQueuePath(customPath);
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const lines = items.map((item) => JSON.stringify(item));
  writeFileSync(filePath, lines.join("\n") + (lines.length > 0 ? "\n" : ""), "utf8");
}

export function clearFeedbackQueue(customPath?: string): void {
  const filePath = resolveFeedbackQueuePath(customPath);
  if (existsSync(filePath)) {
    rmSync(filePath, { force: true });
  }
}

export function appendFeedbackItem(
  item: Omit<FeedbackItem, "timestamp"> & { timestamp?: string },
  customPath?: string,
): FeedbackItem {
  const existing = readFeedbackQueue(customPath);
  const duplicate = existing.find((e) => e.id === item.id);
  if (duplicate) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Feedback item with id '${item.id}' already exists in the queue`,
    );
  }

  const newItem: FeedbackItem = {
    ...item,
    timestamp: item.timestamp ?? new Date().toISOString(),
  };

  const updated = [...existing, newItem];
  writeFeedbackQueue(updated, customPath);
  return newItem;
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
    const existing = readFeedbackQueue(customPath);
    const index = existing.findIndex((e) => e.id === idOrItem);
    if (index === -1) {
      throw new HarnessError(
        "INVALID_STATE",
        `Feedback item with id '${idOrItem}' not found in queue`,
      );
    }
    const current = existing[index]!;
    const updatedItem: FeedbackItem = {
      ...current,
      status: "ADMITTED",
      processed_at: current.processed_at ?? new Date().toISOString(),
    };
    const updatedList = [...existing];
    updatedList[index] = updatedItem;
    writeFeedbackQueue(updatedList, customPath);
    return updatedItem;
  }

  const existing = readFeedbackQueue(customPath);
  const existingIndex = existing.findIndex((e) => e.id === idOrItem.id);
  if (existingIndex !== -1) {
    const current = existing[existingIndex]!;
    const updatedItem: FeedbackItem = {
      ...current,
      ...idOrItem,
      timestamp: idOrItem.timestamp ?? current.timestamp,
      status: idOrItem.status ?? "ADMITTED",
      processed_at: current.processed_at ?? new Date().toISOString(),
    };
    const updatedList = [...existing];
    updatedList[existingIndex] = updatedItem;
    writeFeedbackQueue(updatedList, customPath);
    return updatedItem;
  }

  const newItem: FeedbackItem = {
    ...idOrItem,
    status: idOrItem.status ?? "ADMITTED",
    timestamp: idOrItem.timestamp ?? new Date().toISOString(),
    processed_at: new Date().toISOString(),
  };
  const updatedList = [...existing, newItem];
  writeFeedbackQueue(updatedList, customPath);
  return newItem;
}

export function updateFeedbackItem(
  id: string,
  update: Partial<FeedbackItem>,
  customPath?: string,
): FeedbackItem {
  const existing = readFeedbackQueue(customPath);
  const index = existing.findIndex((e) => e.id === id);
  if (index === -1) {
    throw new HarnessError("INVALID_STATE", `Feedback item with id '${id}' not found in queue`);
  }

  const current = existing[index]!;
  const updatedItem: FeedbackItem = {
    ...current,
    ...update,
    id: current.id,
    timestamp: current.timestamp,
  };

  const updatedList = [...existing];
  updatedList[index] = updatedItem;
  writeFeedbackQueue(updatedList, customPath);
  return updatedItem;
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
  const filePath = resolveFeedbackQueuePath(options?.customPath);
  const existing = readFeedbackQueue(filePath);
  const index = existing.findIndex(
    (e) => e.id === idOrTaskId || (e.candidate_id && e.candidate_id === idOrTaskId),
  );
  if (index === -1) {
    throw new HarnessError(
      "INVALID_STATE",
      `Feedback item matching id or candidate_id '${idOrTaskId}' not found in queue`,
    );
  }

  const validatedProof = validateFeedbackResolutionProof(proof, {
    requireCommitSha: options?.requireCommitSha,
    requireTestPath: options?.requireTestPath,
  });

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

  const updatedList = [...existing];
  updatedList[index] = updatedItem;
  writeFeedbackQueue(updatedList, filePath);
  return updatedItem;
}

export function backpropagateFeedbackResolution(
  records: readonly BackpropagationRecord[],
  customPath?: string,
): FeedbackItem[] {
  const filePath = resolveFeedbackQueuePath(customPath);
  if (!existsSync(filePath) || records.length === 0) {
    return [];
  }

  const existing = readFeedbackQueue(filePath);
  if (existing.length === 0) {
    return [];
  }

  const taskMap = new Map<string, BackpropagationRecord>();
  for (const r of records) {
    taskMap.set(r.id, r);
  }

  const updatedItems: FeedbackItem[] = [];
  const nextList: FeedbackItem[] = [];
  let changed = false;

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
      changed = true;
    } else {
      nextList.push(item);
    }
  }

  if (changed) {
    writeFeedbackQueue(nextList, filePath);
  }

  return updatedItems;
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
  const existing = readFeedbackQueue(customPath);
  const markAs = options.markAs !== undefined ? options.markAs : "PROCESSED";
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  const nowIso = new Date().toISOString();

  const selected: FeedbackItem[] = [];
  const updatedList: FeedbackItem[] = [];

  for (const item of existing) {
    const matchesCategory = !options.category || item.category === options.category;
    const matchesCustom = !options.filter || options.filter(item);
    if (item.status === "PENDING" && matchesCategory && matchesCustom && selected.length < limit) {
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

  if (selected.length > 0) {
    writeFeedbackQueue(updatedList, customPath);
  }

  return selected;
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
  return "NORMAL";
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
  return "PENDING";
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
  }
  return "GENERAL";
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
  const filePath = resolveFeedbackQueuePath(customPath);
  const existing = readFeedbackQueue(filePath);
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

  writeFeedbackQueue(updatedList, filePath);

  return {
    feedback_item: admittedItem,
    dispatched_task_id: dispatchRes.taskId.trim(),
    admitted_at: nowIso,
    auto_enqueued: dispatchRes.autoEnqueued ?? true,
  };
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

  const filePath = resolveFeedbackQueuePath(options.feedbackPath);
  const existing = readFeedbackQueue(filePath);
  const pausedIds = new Set(audit.paused_admitted_feedbacks.map((f) => f.id));
  const remediated: FeedbackItem[] = [];

  const updatedList = existing.map((item) => {
    if (pausedIds.has(item.id)) {
      const resetStatus: FeedbackStatus = options.resetToPending ? "PENDING" : "ADMITTED";
      const updated: FeedbackItem = {
        ...item,
        status: resetStatus,
        processed_at: null,
      };
      remediated.push(updated);
      return updated;
    }
    return item;
  });

  writeFeedbackQueue(updatedList, filePath);
  return {
    reconciled_count: remediated.length,
    remediated_feedbacks: remediated,
  };
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
  const existing = readFeedbackQueue(target);
  const map = new Map<string, FeedbackItem>();
  for (const r of existing) map.set(r.id, r);
  for (const r of records) map.set(r.id, r);
  writeFeedbackQueue(Array.from(map.values()), target);
  return { migrated: true, count: records.length };
}
