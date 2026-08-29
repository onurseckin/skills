import type { AggregatedDefect, DefectEntry, DefectRecordInput, LiveDeduplicationOptions } from "./types.ts";
import { categorizeDefect, deduplicateDefectLog, toAggregatedDefect } from "./dedup.ts";

export { categorizeDefect };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeText(text: unknown): string {
  return typeof text === "string" ? text.trim() : "";
}

export function parseDefectLog(
  rawContent: string,
  options: { capsuleRoot?: string | undefined; capsule_root?: string | undefined } = {},
): DefectEntry[] {
  if (!rawContent || !rawContent.trim()) return [];
  const lines = rawContent.split("\n");
  const entries: DefectEntry[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!isRecord(parsed)) continue;
      const item = parsed;
      const rawStatus = typeof item["status"] === "string" ? item["status"].toLowerCase().trim() : "open";
      let status: "open" | "resolved" | "wontfix" = "open";
      if (rawStatus === "resolved") status = "resolved";
      else if (rawStatus === "wontfix" || rawStatus === "wont_fix" || rawStatus === "wont-fix") status = "wontfix";
      else status = "open";

      const rawSeverity = typeof item["severity"] === "string" ? item["severity"].toLowerCase().trim() : "warning";
      const severity = ["critical", "high", "warning", "low", "info"].includes(rawSeverity) ? rawSeverity : "warning";
      const obs = (item["observation"] || item["message"] || "") as string;
      const rem = (item["remediation"] || item["prescribed_remediation"] || "") as string;
      const id = (item["id"] || item["defect_id"] || "") as string;
      const type = (item["type"] || item["error_code"] || item["category"] || "") as string;
      const timestamp = (item["timestamp"] || item["created_at"] || new Date().toISOString()) as string;
      const category = categorizeDefect(item as unknown as DefectEntry);

      const record: DefectEntry = {
        ...item,
        id,
        type,
        timestamp,
        status: status as DefectEntry["status"],
        severity: severity as DefectEntry["severity"],
        category: category as DefectEntry["category"],
        observation: obs,
        message: obs,
        remediation: rem,
        prescribed_remediation: rem,
        ...(options.capsule_root || options.capsuleRoot
          ? { capsule_root: options.capsule_root || options.capsuleRoot, capsuleRoot: options.capsule_root || options.capsuleRoot }
          : {}),
      } as unknown as DefectEntry;

      entries.push(record);
    } catch {
      continue;
    }
  }

  return entries;
}

export function deserializeDefectRecord(raw: unknown): AggregatedDefect | null {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (!isRecord(parsed)) return null;
      return toAggregatedDefect(parsed as DefectRecordInput);
    } catch {
      return null;
    }
  }
  if (isRecord(raw)) {
    return toAggregatedDefect(raw as DefectRecordInput);
  }
  return null;
}

export function serializeDefectLog(defects: readonly DefectEntry[]): string {
  if (!defects || defects.length === 0) return "";
  return defects.map((d) => JSON.stringify(d)).join("\n") + "\n";
}

export function serializeAggregatedDefectLog(defects: readonly AggregatedDefect[]): string {
  if (!Array.isArray(defects) || defects.length === 0) return "";
  return `${defects.map((b) => JSON.stringify(b)).join("\n")}\n`;
}

export function parseAndDeduplicateDefectJsonl(
  jsonlContent: string,
  options: LiveDeduplicationOptions = {},
): AggregatedDefect[] {
  if (typeof jsonlContent !== "string" || !jsonlContent.trim()) return [];
  const rawLines = jsonlContent.split("\n");
  const inputs: DefectRecordInput[] = [];

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isRecord(parsed)) inputs.push(parsed as DefectRecordInput);
    } catch {
      continue;
    }
  }

  return deduplicateDefectLog(inputs, options);
}
