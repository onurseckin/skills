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
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "0" ||
    normalized === "tier-0" ||
    normalized === "tier_0" ||
    normalized === "tier 0" ||
    normalized === "human" ||
    normalized === "mind" ||
    normalized.startsWith("tier 0") ||
    normalized.startsWith("tier 0:")
  ) {
    return 0;
  }
  if (
    normalized === "1" ||
    normalized === "tier-1" ||
    normalized === "tier_1" ||
    normalized === "tier 1" ||
    normalized === "orchestrator" ||
    normalized === "orch" ||
    normalized === "mind-auditor" ||
    normalized === "auditor" ||
    normalized.startsWith("tier 1") ||
    normalized.startsWith("tier 1:")
  ) {
    return 1;
  }
  if (
    normalized === "2" ||
    normalized === "tier-2" ||
    normalized === "tier_2" ||
    normalized === "tier 2" ||
    normalized === "coordinator" ||
    normalized === "coord" ||
    normalized.startsWith("tier 2") ||
    normalized.startsWith("tier 2:")
  ) {
    return 2;
  }
  if (
    normalized === "3" ||
    normalized === "tier-3" ||
    normalized === "tier_3" ||
    normalized === "tier 3" ||
    normalized === "implementer" ||
    normalized === "validator" ||
    normalized === "critic" ||
    normalized === "completeness-critic" ||
    normalized === "repairer" ||
    normalized === "planner" ||
    normalized === "plan-validator" ||
    normalized.startsWith("tier 3") ||
    normalized.startsWith("tier 3:")
  ) {
    return 3;
  }
  return null;
}

export function roleToTier(role: string): ExecutionTier {
  if (!role || typeof role !== "string") {
    return 3;
  }
  const normalized = role.toLowerCase().trim();
  if (
    normalized === "mind" ||
    normalized === "human" ||
    normalized === "user" ||
    normalized === "lead"
  ) {
    return 0;
  }
  if (
    normalized === "orchestrator" ||
    normalized.startsWith("orch-") ||
    normalized.startsWith("orchestrator-") ||
    normalized === "orch" ||
    normalized === "mind-auditor" ||
    normalized === "auditor"
  ) {
    return 1;
  }
  if (
    normalized === "coordinator" ||
    normalized.startsWith("coord-") ||
    normalized.startsWith("coordinator-") ||
    normalized === "coord"
  ) {
    return 2;
  }
  return 3;
}

export function agentIdToTier(agentId: string): ExecutionTier | null {
  if (!agentId || typeof agentId !== "string") return null;
  const normalized = agentId
    .toLowerCase()
    .trim()
    .replace(/^(?:parent|agent)[-_]/i, "");
  if (/^mind[-_]audit|^audit/i.test(normalized)) return 1;
  if (/^mind|^human/i.test(normalized)) return 0;
  if (/^orch/i.test(normalized)) return 1;
  if (/^coord/i.test(normalized)) return 2;
  if (
    /^(impl|val|critic|completeness[-_]critic|repair|worker|sub|plan|mechanic|ui)/i.test(normalized)
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
  if (/^mind[-_]audit|^audit/i.test(normalized)) return "mind-auditor";
  if (/^mind/i.test(normalized)) return "mind";
  if (/^human/i.test(normalized)) return "human";
  if (/^orch/i.test(normalized)) return "orchestrator";
  if (/^coord/i.test(normalized)) return "coordinator";
  if (/^ui[-_]mechanic[-_]validator/i.test(normalized)) return "ui-mechanic-validator";
  if (/^ui[-_]validator/i.test(normalized)) return "ui-validator";
  if (/^mechanic[-_]validator/i.test(normalized)) return "mechanic-validator";
  if (/^validator[-_]code[-_]quality/i.test(normalized)) return "validator-code-quality";
  if (/^validator[-_]ui[-_]design/i.test(normalized)) return "validator-ui-design";
  if (/^validator[-_]security/i.test(normalized)) return "validator-security";
  if (/^validator[-_]product/i.test(normalized)) return "validator-product";
  if (/^validator[-_]system[-_]design/i.test(normalized)) return "validator-system-design";
  if (/^sub[-_]implementer/i.test(normalized)) return "sub-implementer";
  if (/^sub[-_]validator/i.test(normalized)) return "sub-validator";
  if (/^sub[-_]investigator/i.test(normalized)) return "sub-investigator";
  if (/^impl/i.test(normalized)) return "implementer";
  if (/^val/i.test(normalized)) return "validator";
  if (/^(completeness[-_]critic|critic)/i.test(normalized)) return "completeness-critic";
  if (/^repair/i.test(normalized)) return "repairer";
  if (/^plan[-_]val/i.test(normalized)) return "plan-validator";
  if (/^plan/i.test(normalized)) return "planner";
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
