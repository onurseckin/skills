import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { durableAppendBytes } from "../../core/durable-write.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { resolveDefectsPath } from "../../core/shared/paths.ts";
import type { DefectRecord, ExecutionTier } from "./types.ts";

export function safeErrorDetail(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return `${value}`;
  }
  if (typeof value === "symbol") return "symbol error";
  try {
    const message = Object.getOwnPropertyDescriptor(value, "message");
    if (message && "value" in message && typeof message.value === "string") return message.value;
  } catch {}
  return "unavailable error detail";
}

export function safeDefectId(defect: DefectRecord): string {
  try {
    const id = Object.getOwnPropertyDescriptor(defect, "id");
    if (id && "value" in id && typeof id.value === "string") return id.value;
  } catch {}
  return "<unavailable defect id>";
}

export function parseTierValue(value: string | undefined): ExecutionTier | null {
  if (!value) return null;
  const normalized = value.trim();
  if (normalized === "0") return 0;
  if (normalized === "1") return 1;
  if (normalized === "2") return 2;
  if (normalized === "3") return 3;
  return null;
}

export function roleToTier(role: string): ExecutionTier {
  if (!role || typeof role !== "string") {
    return 3;
  }
  const normalized = role.toLowerCase().trim();
  if (normalized === "mind") return 0;
  if (normalized === "orchestrator" || normalized === "mind-auditor") return 1;
  if (normalized === "coordinator") return 2;
  return 3;
}

export function agentIdToTier(agentId: string): ExecutionTier | null {
  if (!agentId || typeof agentId !== "string") return null;
  const normalized = agentId
    .toLowerCase()
    .trim()
    .replace(/^(?:parent|agent)[-_]/i, "");
  if (normalized.startsWith("mind-auditor")) return 1;
  if (normalized.startsWith("mind")) return 0;
  if (normalized.startsWith("orchestrator")) return 1;
  if (normalized.startsWith("coordinator")) return 2;
  if (
    normalized.startsWith("implementer") ||
    normalized.startsWith("validator") ||
    normalized.startsWith("completeness-critic") ||
    normalized.startsWith("repairer") ||
    normalized.startsWith("planner") ||
    normalized.startsWith("plan-validator") ||
    normalized.startsWith("sub-implementer") ||
    normalized.startsWith("sub-validator") ||
    normalized.startsWith("sub-investigator") ||
    normalized.startsWith("validator-code-quality") ||
    normalized.startsWith("validator-ui-design") ||
    normalized.startsWith("validator-security") ||
    normalized.startsWith("validator-product") ||
    normalized.startsWith("validator-system-design") ||
    normalized.startsWith("ui-headless-validator") ||
    normalized.startsWith("ui-optical-validator")
  ) {
    return 3;
  }
  return null;
}

export function agentIdToRole(agentId: string): string | null {
  if (!agentId || typeof agentId !== "string") return null;
  const normalized = agentId
    .toLowerCase()
    .trim()
    .replace(/^(?:parent|agent)[-_]/i, "");
  if (normalized.startsWith("mind-auditor")) return "mind-auditor";
  if (normalized.startsWith("mind")) return "mind";
  if (normalized.startsWith("orchestrator")) return "orchestrator";
  if (normalized.startsWith("coordinator")) return "coordinator";
  if (normalized.startsWith("ui-headless-validator")) return "ui-headless-validator";
  if (normalized.startsWith("ui-optical-validator")) return "ui-optical-validator";
  if (normalized.startsWith("validator-code-quality")) return "validator-code-quality";
  if (normalized.startsWith("validator-ui-design")) return "validator-ui-design";
  if (normalized.startsWith("validator-security")) return "validator-security";
  if (normalized.startsWith("validator-product")) return "validator-product";
  if (normalized.startsWith("validator-system-design")) return "validator-system-design";
  if (normalized.startsWith("sub-implementer")) return "sub-implementer";
  if (normalized.startsWith("sub-validator")) return "sub-validator";
  if (normalized.startsWith("sub-investigator")) return "sub-investigator";
  if (normalized.startsWith("implementer")) return "implementer";
  if (normalized.startsWith("validator")) return "validator";
  if (normalized.startsWith("completeness-critic")) return "completeness-critic";
  if (normalized.startsWith("repairer")) return "repairer";
  if (normalized.startsWith("plan-validator")) return "plan-validator";
  if (normalized.startsWith("planner")) return "planner";
  return null;
}

export function recordDefect(
  defect: DefectRecord,
  options: { runRoot?: string | undefined; cwd?: string | undefined } = {},
): DefectRecord {
  let targetFile = "<unresolved defects ledger>";
  const defectId = safeDefectId(defect);
  try {
    targetFile = resolve(
      options.runRoot ? join(options.runRoot, "defects.jsonl") : resolveDefectsPath(options.cwd),
    );
    const dir = dirname(targetFile);
    mkdirSync(dir, { recursive: true });
    const serialized = JSON.stringify(defect);
    if (typeof serialized !== "string") {
      throw new HarnessError("INTEGRITY", "defect serialization produced no JSON record");
    }
    durableAppendBytes(targetFile, new TextEncoder().encode(`${serialized}\n`));
  } catch (error) {
    const reason = safeErrorDetail(error);
    throw new HarnessError(
      "INTEGRITY",
      `failed to durably persist defect '${defectId}' to '${targetFile}': ${reason}`,
    );
  }
  return defect;
}
