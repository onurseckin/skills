import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { DefectCategory } from "../../defects/index.ts";
import type { FeedbackCategory } from "../queue/index.ts";
import type { PushbackInvariant } from "./types.ts";

const DEFAULT_PUSHBACK_FILE = "USER_PUSHBACK_AND_SELF_AUDIT.md";

export function resolvePushbackMarkdownPath(customPath?: string): string {
  if (customPath && customPath.trim()) {
    return resolve(customPath.trim());
  }
  const cwd = process.cwd();
  const directPath = join(cwd, DEFAULT_PUSHBACK_FILE);
  if (existsSync(directPath)) {
    return directPath;
  }
  const parentPath = join(dirname(cwd), DEFAULT_PUSHBACK_FILE);
  if (existsSync(parentPath)) {
    return parentPath;
  }
  return resolve(cwd, DEFAULT_PUSHBACK_FILE);
}

export function mapFeedbackCategoryToDefectCategory(
  category: FeedbackCategory | string,
): DefectCategory {
  if (typeof category !== "string") {
    return "code_defect";
  }

  const normalized = category.trim().toUpperCase();

  if (normalized === "BOUNDARY_VIOLATION" || normalized === "ROLE_CONFUSION") {
    return "boundary_violation";
  }
  if (normalized === "MODEL_REASONING_ERROR") {
    return "model_reasoning_error";
  }
  if (normalized === "CODE_DEFECT") {
    return "code_defect";
  }

  switch (normalized) {
    case "AGENT_CONTRACTS":
    case "WATCHDOG":
    case "EXECUTION_EFFICIENCY":
      return "boundary_violation";

    case "DOCUMENTATION":
    case "GENERAL":
    case "ARCHITECTURE":
      return "model_reasoning_error";

    case "CLI_TOOLING":
    case "CORE_ENGINE":
    case "REPAIR":
    case "SCALING":
    case "CORE_SCHEDULER":
    case "VALIDATION_ENGINE":
      return "code_defect";

    default: {
      const lower = category.toLowerCase();
      if (
        lower.includes("boundary") ||
        lower.includes("role") ||
        lower.includes("restraint") ||
        lower.includes("contract") ||
        lower.includes("auth") ||
        lower.includes("confinement")
      ) {
        return "boundary_violation";
      }
      if (
        lower.includes("reason") ||
        lower.includes("logic") ||
        lower.includes("hallucination") ||
        lower.includes("doc") ||
        lower.includes("plan") ||
        lower.includes("paralysis") ||
        lower.includes("drift")
      ) {
        return "model_reasoning_error";
      }
      return "code_defect";
    }
  }
}

export function parseInvariantsTable(lines: readonly string[]): PushbackInvariant[] {
  const invariants: PushbackInvariant[] = [];
  let inTable = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) {
      continue;
    }
    const trimmed = line.trim();

    if (
      trimmed.startsWith("|") &&
      trimmed.includes("Invariant") &&
      trimmed.includes("Requirement")
    ) {
      inTable = true;
      continue;
    }

    if (inTable && trimmed.startsWith("|") && trimmed.includes("---")) {
      continue;
    }

    if (inTable && trimmed.startsWith("|")) {
      const parts = trimmed
        .split("|")
        .map((p) => p.trim())
        .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);

      if (parts.length >= 4) {
        const rawInv = parts[0] ?? "";
        const rawReq = parts[1] ?? "";
        const rawStat = parts[2] ?? "";
        const rawEv = parts[3] ?? "";

        const invName = rawInv.replace(/\*\*/g, "").trim();
        invariants.push({
          invariant: invName,
          requirement: rawReq,
          status: rawStat,
          evidence: rawEv,
        });
      }
    } else if (inTable && !trimmed.startsWith("|")) {
      inTable = false;
    }
  }

  return invariants;
}
