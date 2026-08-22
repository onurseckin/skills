import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { HarnessError } from "../errors/harness-error.ts";

export type FeedbackPriority =
  | "CRITICAL_USER_FEEDBACK"
  | "HIGH_ARCHITECTURAL_FEATURE"
  | "USER_DIRECTIVE"
  | "NORMAL"
  | "LOW";

export type FeedbackStatus =
  | "PENDING"
  | "ADMITTED"
  | "DECLINED"
  | "PROCESSED"
  | "COMPLETED";

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

export interface FeedbackItem {
  readonly id: string;
  readonly timestamp: string;
  readonly priority: FeedbackPriority;
  readonly status: FeedbackStatus;
  readonly category: FeedbackCategory;
  readonly title: string;
  readonly content: string;
  readonly candidate_id?: string | null;
  readonly resolution_note?: string | null | undefined;
  readonly processed_at?: string | null | undefined;
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

const DEFAULT_FEEDBACK_FILE = ".capsules/FEEDBACK_QUEUE.jsonl";

export function resolveFeedbackQueuePath(customPath?: string): string {
  if (customPath && customPath.trim()) {
    return resolve(customPath.trim());
  }
  const cwd = process.cwd();
  // Check if we are inside orchestrating-long-tasks
  if (existsSync(join(cwd, ".capsules"))) {
    return join(cwd, DEFAULT_FEEDBACK_FILE);
  }
  const parentCapsules = join(dirname(cwd), ".capsules");
  if (existsSync(parentCapsules)) {
    return join(dirname(cwd), DEFAULT_FEEDBACK_FILE);
  }
  return resolve(cwd, DEFAULT_FEEDBACK_FILE);
}

export function readFeedbackQueue(customPath?: string): FeedbackItem[] {
  const filePath = resolveFeedbackQueuePath(customPath);
  if (!existsSync(filePath)) {
    return [];
  }

  const raw = readFileSync(filePath, "utf8");
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const items: FeedbackItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (!parsed["id"] || typeof parsed["id"] !== "string") {
        continue;
      }
      const item: FeedbackItem = {
        id: String(parsed["id"]),
        timestamp: typeof parsed["timestamp"] === "string" ? parsed["timestamp"] : new Date().toISOString(),
        priority: validatePriority(parsed["priority"]),
        status: validateStatus(parsed["status"]),
        category: validateCategory(parsed["category"]),
        title: typeof parsed["title"] === "string" ? parsed["title"] : `Feedback ${parsed["id"]}`,
        content: typeof parsed["content"] === "string" ? parsed["content"] : "",
        candidate_id: typeof parsed["candidate_id"] === "string" ? parsed["candidate_id"] : null,
        resolution_note: typeof parsed["resolution_note"] === "string" ? parsed["resolution_note"] : null,
        processed_at: typeof parsed["processed_at"] === "string" ? parsed["processed_at"] : null,
        metadata: typeof parsed["metadata"] === "object" && parsed["metadata"] !== null
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

export function appendFeedbackItem(item: Omit<FeedbackItem, "timestamp"> & { timestamp?: string }, customPath?: string): FeedbackItem {
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

export function updateFeedbackItem(
  id: string,
  update: Partial<FeedbackItem>,
  customPath?: string,
): FeedbackItem {
  const existing = readFeedbackQueue(customPath);
  const index = existing.findIndex((e) => e.id === id);
  if (index === -1) {
    throw new HarnessError(
      "INVALID_STATE",
      `Feedback item with id '${id}' not found in queue`,
    );
  }

  const current = existing[index]!;
  const updatedItem: FeedbackItem = {
    ...current,
    ...update,
    id: current.id, // Immutable ID
    timestamp: current.timestamp, // Immutable creation timestamp
  };

  const updatedList = [...existing];
  updatedList[index] = updatedItem;
  writeFeedbackQueue(updatedList, customPath);
  return updatedItem;
}

export function drainPendingFeedbacks(
  options: {
    readonly markAs?: FeedbackStatus;
    readonly limit?: number;
    readonly category?: FeedbackCategory;
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
    if (item.status === "PENDING" && matchesCategory && selected.length < limit) {
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

const PRIORITY_ORDER: Record<FeedbackPriority, number> = {
  CRITICAL_USER_FEEDBACK: 1,
  HIGH_ARCHITECTURAL_FEATURE: 2,
  USER_DIRECTIVE: 3,
  NORMAL: 4,
  LOW: 5,
};

function sortFeedbackByPriority(items: FeedbackItem[]): FeedbackItem[] {
  return [...items].sort((a, b) => {
    const pDiff = (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99);
    if (pDiff !== 0) return pDiff;
    return a.timestamp.localeCompare(b.timestamp);
  });
}

function validatePriority(val: unknown): FeedbackPriority {
  if (typeof val === "string") {
    const upper = val.toUpperCase();
    if (upper === "CRITICAL_USER_FEEDBACK" || upper === "CRITICAL") return "CRITICAL_USER_FEEDBACK";
    if (upper === "HIGH_ARCHITECTURAL_FEATURE" || upper === "HIGH") return "HIGH_ARCHITECTURAL_FEATURE";
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
