import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { enforceLineLimit, formatTable } from "../../../cli/formatters/line-limiter.ts";
import { nextActionsBlock } from "../../../cli/formatters/next-actions.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import { pruneDefectLedgerRecords } from "../../../logging/defect-logger.ts";
import {
  resolveFeedbackQueuePath,
  updateOrPruneFeedbackItems,
  type FeedbackResolutionProof,
} from "../../feedback/queue/index.ts";
import type {
  CompletedTaskRecord,
  CompletedTasksStats,
  RecordCompletedTaskOptions,
} from "./types.ts";
import {
  isOwnCode,
  readLedgerFile,
  resolveCompletedTasksLedgerPath,
  resolveDefectsPath,
  withLedgerTransaction,
} from "./types.ts";
import { atomicWriteLedger, validateCompletedTaskRecord } from "./storage.ts";

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

export function writeCompletedTasksLedgerUnlocked(
  items: readonly CompletedTaskRecord[],
  filePath: string,
): void {
  const lines = items.map((item) => JSON.stringify(validateCompletedTaskRecord(item)));
  atomicWriteLedger(filePath, lines.join("\n") + (lines.length > 0 ? "\n" : ""));
}

export function updateFeedbackQueueItems(
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

export function updateDefectItems(
  records: readonly CompletedTaskRecord[],
  customPath?: string,
): void {
  const filePath = resolveDefectsPath(customPath);
  if (!existsSync(filePath)) {
    return;
  }
  const idMap = new Map<string, CompletedTaskRecord>();
  for (const r of records) {
    idMap.set(r.id.toLowerCase().trim(), r);
  }

  pruneDefectLedgerRecords(filePath, (entry) => {
    const id = entry.id.toLowerCase().trim();
    const status = entry.value.status;
    return idMap.has(id) || status === "resolved" || status === "RESOLVED" || status === "CLOSED";
  });
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
  if (options?.updateDefects) {
    updateDefectItems(recorded, options.defectsPath);
  }
  return recorded;
}

export function recordCompletedTasksBatchUnlocked(
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
