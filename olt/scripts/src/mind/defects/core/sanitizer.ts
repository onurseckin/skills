import { HarnessError } from "../../../core/errors/index.ts";
import type { DefectCategory, DefectEntry, DefectRecordInput } from "./types.ts";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeText(text: unknown): string {
  return typeof text === "string" ? text.trim() : "";
}

export function categorizeDefect(defect: DefectEntry | Record<string, unknown>): DefectCategory {
  const explicitCat = String(defect.category || "").toLowerCase().trim();
  if (explicitCat === "boundary_violation" || explicitCat === "role_confusion" || explicitCat === "confinement_breach" || explicitCat === "leak") {
    return "boundary_violation";
  }
  if (explicitCat === "model_reasoning_error" || explicitCat === "hallucination" || explicitCat === "reasoning_drift" || explicitCat === "drift") {
    return "model_reasoning_error";
  }
  if (explicitCat === "code_defect" || explicitCat === "syntax_error" || explicitCat === "type_error") {
    return "code_defect";
  }
  if (explicitCat === "documentation" || explicitCat === "security_risk" || explicitCat === "modularity_violation") {
    return explicitCat as DefectCategory;
  }

  const rawType = String(defect.type || defect.error_code || "").toLowerCase().replace(/[_-]/g, " ");
  const rawObs = String(defect.observation || defect.description || defect.message || "").toLowerCase().replace(/[_-]/g, " ");
  const rawRem = String(defect.remediation || defect.prescribed_remediation || "").toLowerCase().replace(/[_-]/g, " ");
  const text = `${rawType} ${rawObs} ${rawRem}`;

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
    text.includes("direct file write") ||
    text.includes("without subagent") ||
    text.includes("human shell") ||
    text.includes("thread restraint")
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
    text.includes("illogical decision") ||
    text.includes("reasoning error")
  ) {
    return "model_reasoning_error";
  }

  return "code_defect";
}
