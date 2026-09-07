import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { durableAppendBytes } from "../../core/durable-write.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { resolveDefectsPath } from "../../core/shared/paths.ts";
import {
  agentIdToRole,
  agentIdToTier,
  parseTierValue,
  roleToTier,
  type ExecutionTier,
} from "./tier/index.ts";
import type { DefectRecord } from "./types.ts";

export { agentIdToRole, agentIdToTier, parseTierValue, roleToTier, type ExecutionTier };

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
