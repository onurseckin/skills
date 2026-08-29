import { join } from "node:path";
import { HarnessError } from "../../../core/errors/index.ts";
import type { DefectCategory, DefectEntry, DefectRecordInput } from "./types.ts";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeText(text: unknown): string {
  return typeof text === "string" ? text.trim() : "";
}

export function categorizeDefect(
  defect: DefectEntry | DefectRecordInput | Record<string, unknown>,
): DefectCategory {
  const d = defect as Record<string, unknown>;
  const explicitCat = String(d["category"] || "")
    .toLowerCase()
    .trim();
  if (
    explicitCat === "boundary_violation" ||
    explicitCat === "role_confusion" ||
    explicitCat === "confinement_breach" ||
    explicitCat === "leak"
  ) {
    return "boundary_violation";
  }
  if (
    explicitCat === "model_reasoning_error" ||
    explicitCat === "hallucination" ||
    explicitCat === "reasoning_drift" ||
    explicitCat === "drift"
  ) {
    return "model_reasoning_error";
  }
  if (
    explicitCat === "code_defect" ||
    explicitCat === "syntax_error" ||
    explicitCat === "type_error"
  ) {
    return "code_defect";
  }
  if (
    explicitCat === "documentation" ||
    explicitCat === "security_risk" ||
    explicitCat === "modularity_violation"
  ) {
    return explicitCat as DefectCategory;
  }

  const rawId = String(d["id"] || "")
    .toLowerCase()
    .replace(/[_-]/g, " ");
  const rawType = String(d["type"] || d["error_code"] || "")
    .toLowerCase()
    .replace(/[_-]/g, " ");
  const rawObs = String(d["observation"] || d["description"] || d["message"] || "")
    .toLowerCase()
    .replace(/[_-]/g, " ");
  const rawRem = String(d["remediation"] || d["prescribed_remediation"] || "")
    .toLowerCase()
    .replace(/[_-]/g, " ");
  const text = `${rawId} ${rawType} ${rawObs} ${rawRem}`;

  if (
    text.includes("boundary") ||
    text.includes("confusion") ||
    text.includes("leak") ||
    text.includes("unauthorized") ||
    text.includes("restraint") ||
    text.includes("escalation") ||
    text.includes("breach") ||
    text.includes("tier escaped") ||
    text.includes("permission denied") ||
    text.includes("direct execution") ||
    text.includes("direct file") ||
    text.includes("without subagent") ||
    text.includes("human shell") ||
    text.includes("thread restraint") ||
    text.includes("sandbox escape") ||
    text.includes("role amnesia") ||
    text.includes("identity and role") ||
    text.includes("spillover") ||
    text.includes("whoami") ||
    text.includes("non implementation") ||
    text.includes("write scope")
  ) {
    return "boundary_violation";
  }

  if (
    text.includes("hallucination") ||
    text.includes("drift") ||
    text.includes("self critique") ||
    text.includes("context loss") ||
    text.includes("paralysis") ||
    text.includes("idle death") ||
    text.includes("incorrect premise") ||
    text.includes("wrong premise") ||
    text.includes("illogical") ||
    text.includes("logic inconsistency") ||
    text.includes("invalid assumption") ||
    text.includes("passive inertia") ||
    text.includes("self termination") ||
    text.includes("sleep loop") ||
    text.includes("consciousness") ||
    text.includes("reasoning error") ||
    text.includes("reasoning")
  ) {
    return "model_reasoning_error";
  }

  return "code_defect";
}

export function parseDefectLog(
  rawContent: string,
  options: { capsuleRoot?: string; capsule_root?: string } = {},
): DefectEntry[] {
  if (!rawContent || !rawContent.trim()) return [];
  const lines = rawContent.split("\n");
  const entries: DefectEntry[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        continue;
      }
      const item = parsed as Record<string, unknown>;
      const rawStatus =
        typeof item["status"] === "string" ? item["status"].toLowerCase().trim() : "open";
      let status: "open" | "resolved" | "wontfix" = "open";
      if (rawStatus === "resolved") status = "resolved";
      else if (rawStatus === "wontfix" || rawStatus === "wont_fix" || rawStatus === "wont-fix")
        status = "wontfix";
      else status = "open";

      const rawSeverity =
        typeof item["severity"] === "string" ? item["severity"].toLowerCase().trim() : "warning";
      const severity = ["critical", "high", "warning", "low", "info"].includes(rawSeverity)
        ? rawSeverity
        : "warning";

      const obs = (item["observation"] || item["message"] || "") as string;
      const rem = (item["remediation"] || item["prescribed_remediation"] || "") as string;

      const category = categorizeDefect(item as unknown as DefectEntry);

      const record: DefectEntry = {
        ...item,
        status: status as DefectEntry["status"],
        severity: severity as DefectEntry["severity"],
        category: category as DefectEntry["category"],
        ...(obs ? { observation: obs, message: obs } : {}),
        ...(rem ? { remediation: rem, prescribed_remediation: rem } : {}),
        ...(options.capsule_root || options.capsuleRoot
          ? {
              capsule_root: options.capsule_root || options.capsuleRoot,
              capsuleRoot: options.capsule_root || options.capsuleRoot,
            }
          : {}),
      } as unknown as DefectEntry;

      entries.push(record);
    } catch {
      continue;
    }
  }

  return entries;
}

export function serializeDefectLog(defects: readonly DefectEntry[]): string {
  if (!defects || defects.length === 0) return "";
  return defects.map((d) => JSON.stringify(d)).join("\n") + "\n";
}
