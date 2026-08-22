import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { enforceLineLimit, formatTable } from "../cli/formatters/line-limiter.ts";
import { nextActionsBlock } from "../cli/formatters/next-actions.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { resolveFeedbackQueuePath } from "./feedback-queue.ts";

export type CompletedTaskSource =
  | "feedback_queue"
  | "blunder"
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
  readonly blundersPath?: string | undefined;
  readonly updateBlunders?: boolean | undefined;
}

const DEFAULT_COMPLETED_TASKS_FILE = ".capsules/COMPLETED_TASKS.jsonl";
const DEFAULT_BLUNDERS_FILE = ".capsules/blunders.jsonl";

export function resolveCompletedTasksLedgerPath(customPath?: string): string {
  if (customPath && customPath.trim()) {
    return resolve(customPath.trim());
  }
  const cwd = process.cwd();
  if (existsSync(join(cwd, ".capsules"))) {
    return join(cwd, DEFAULT_COMPLETED_TASKS_FILE);
  }
  const parentCapsules = join(dirname(cwd), ".capsules");
  if (existsSync(parentCapsules)) {
    return join(dirname(cwd), DEFAULT_COMPLETED_TASKS_FILE);
  }
  return resolve(cwd, DEFAULT_COMPLETED_TASKS_FILE);
}

export function resolveBlundersPath(customPath?: string): string {
  if (customPath && customPath.trim()) {
    return resolve(customPath.trim());
  }
  const cwd = process.cwd();
  if (existsSync(join(cwd, ".capsules"))) {
    return join(cwd, DEFAULT_BLUNDERS_FILE);
  }
  const parentCapsules = join(dirname(cwd), ".capsules");
  if (existsSync(parentCapsules)) {
    return join(dirname(cwd), DEFAULT_BLUNDERS_FILE);
  }
  return resolve(cwd, DEFAULT_BLUNDERS_FILE);
}

export function validateCompletedTaskSource(val: unknown): CompletedTaskSource {
  if (typeof val === "string") {
    const lower = val.trim().toLowerCase();
    if (lower === "feedback_queue" || lower === "feedback") return "feedback_queue";
    if (lower === "blunder" || lower === "blunders") return "blunder";
    if (lower === "task_queue" || lower === "queue") return "task_queue";
    if (lower === "mind_plan" || lower === "plan") return "mind_plan";
    if (lower === "direct") return "direct";
    if (lower === "external") return "external";
  }
  return "direct";
}

export function validateCompletedTaskStatus(val: unknown): CompletedTaskStatus {
  if (typeof val === "string") {
    const upper = val.trim().toUpperCase();
    if (upper === "RESOLVED") return "RESOLVED";
    if (upper === "COMPLETED") return "COMPLETED";
  }
  return "COMPLETED";
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
  const title =
    typeof r["title"] === "string" && r["title"].trim() ? r["title"].trim() : `Task ${id}`;
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
      : new Date().toISOString();

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
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

export function readCompletedTasksLedger(customPath?: string): CompletedTaskRecord[] {
  const filePath = resolveCompletedTasksLedgerPath(customPath);
  if (!existsSync(filePath)) {
    return [];
  }

  const raw = readFileSync(filePath, "utf8");
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
    } catch {
      // Skip malformed individual line in log
    }
  }

  return items;
}

export function writeCompletedTasksLedger(
  items: readonly CompletedTaskRecord[],
  customPath?: string,
): void {
  const filePath = resolveCompletedTasksLedgerPath(customPath);
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const lines = items.map((item) => JSON.stringify(item));
  writeFileSync(filePath, lines.join("\n") + (lines.length > 0 ? "\n" : ""), "utf8");
}

function updateFeedbackQueueItems(
  records: readonly CompletedTaskRecord[],
  customPath?: string,
): void {
  const filePath = resolveFeedbackQueuePath(customPath);
  if (!existsSync(filePath)) {
    return;
  }
  const idMap = new Map<string, CompletedTaskRecord>();
  for (const r of records) {
    idMap.set(r.id, r);
  }

  const raw = readFileSync(filePath, "utf8");
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  let changed = false;
  const updatedLines: string[] = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const id = typeof parsed["id"] === "string" ? parsed["id"] : undefined;
      if (id && idMap.has(id)) {
        const record = idMap.get(id)!;
        parsed["status"] = "COMPLETED";
        if (!parsed["resolution_note"] && record.proof_summary) {
          parsed["resolution_note"] = record.proof_summary;
        }
        if (!parsed["processed_at"] && record.completed_at) {
          parsed["processed_at"] = record.completed_at;
        }
        changed = true;
        updatedLines.push(JSON.stringify(parsed));
      } else {
        updatedLines.push(line);
      }
    } catch {
      updatedLines.push(line);
    }
  }

  if (changed) {
    writeFileSync(filePath, updatedLines.join("\n") + "\n", "utf8");
  }
}

function updateBlunderItems(records: readonly CompletedTaskRecord[], customPath?: string): void {
  const filePath = resolveBlundersPath(customPath);
  if (!existsSync(filePath)) {
    return;
  }
  const idMap = new Map<string, CompletedTaskRecord>();
  for (const r of records) {
    idMap.set(r.id, r);
  }

  const raw = readFileSync(filePath, "utf8");
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  let changed = false;
  const updatedLines: string[] = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const id = typeof parsed["id"] === "string" ? parsed["id"] : undefined;
      if (id && idMap.has(id)) {
        const record = idMap.get(id)!;
        parsed["status"] = "resolved";
        parsed["resolution"] = {
          task_id: record.id,
          test_assertion: record.proof_summary,
          resolved_at: record.completed_at,
          commit_sha: record.commit_sha ?? null,
        };
        changed = true;
        updatedLines.push(JSON.stringify(parsed));
      } else {
        updatedLines.push(line);
      }
    } catch {
      updatedLines.push(line);
    }
  }

  if (changed) {
    writeFileSync(filePath, updatedLines.join("\n") + "\n", "utf8");
  }
}

export function recordCompletedTasksBatch(
  records: readonly CompletedTaskRecord[],
  options?: RecordCompletedTaskOptions,
): CompletedTaskRecord[] {
  if (records.length === 0) {
    return [];
  }

  const existing = readCompletedTasksLedger(options?.customPath);
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
  writeCompletedTasksLedger(merged, options?.customPath);

  if (options?.updateFeedbackQueue) {
    updateFeedbackQueueItems(validatedRecords, options?.feedbackQueuePath);
  }

  if (options?.updateBlunders) {
    updateBlunderItems(validatedRecords, options?.blundersPath);
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
