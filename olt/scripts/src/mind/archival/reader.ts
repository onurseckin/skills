import { dirname, resolve } from "node:path";
import { type ArchivedObjectiveRecord } from "./types.ts";
import { readArchivedObjectives, validateArchivedObjectiveRecord } from "./generational.ts";
import { withArchivedObjectivesTransaction } from "./compactor.ts";

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
