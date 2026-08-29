import { dirname, resolve } from "node:path";
import { type ArchivedObjectiveRecord } from "./archival-chunk1.ts";
import { readArchivedObjectives, validateArchivedObjectiveRecord } from "./archival-chunk2.ts";
import { withArchivedObjectivesTransaction } from "./archival-chunk3.ts";


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
export function appendArchivedObjectivesCopies(
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
