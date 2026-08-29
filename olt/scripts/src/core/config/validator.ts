import { HarnessError } from "../errors/index.ts";
import { isAgentRole, type AgentRole } from "../contracts/index.ts";
import { attestedFact, type ExternallyAttestedFact } from "./provenance.ts";
import { QUOTA_FREEZE_THRESHOLD_FLOOR_PCT, type EffectiveQuotaThreshold } from "./contracts.ts";

export function resolveEffectiveQuotaThreshold(
  fact: ExternallyAttestedFact<number | null>,
): EffectiveQuotaThreshold {
  if (fact.source === "config_override" && typeof fact.value === "number") {
    return { value: fact.value, source: fact.source };
  }
  return { value: QUOTA_FREEZE_THRESHOLD_FLOOR_PCT, source: fact.source };
}

export function positiveCount(value: unknown, minimum: number): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum
    ? value
    : null;
}

export function booleanField(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function textField(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function percentField(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : null;
}

export function modelByRoleField(value: unknown): Partial<Record<AgentRole, string>> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const result: Partial<Record<AgentRole, string>> = {};
  for (const [role, model] of Object.entries(record)) {
    if (!isAgentRole(role) || typeof model !== "string" || model.trim().length === 0) return null;
    result[role] = model;
  }
  return result;
}

export function fleetAgentCeilingField(
  value: unknown,
): ExternallyAttestedFact<number | null> | null {
  const count = positiveCount(value, 1);
  return count === null ? null : attestedFact<number | null>(count);
}

export function safeCause(error: unknown): string {
  if (typeof error === "string") return error.slice(0, 240);
  if (
    typeof error === "number" ||
    typeof error === "boolean" ||
    typeof error === "bigint" ||
    typeof error === "symbol" ||
    error === null ||
    error === undefined
  ) {
    return String(error).slice(0, 240);
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "message");
    if (descriptor && "value" in descriptor && typeof descriptor.value === "string")
      return descriptor.value.slice(0, 240);
  } catch {
    // Retain a generic cause when an untrusted object rejects inspection.
  }
  return "unknown error";
}

export function invalidConfig(filePath: string, key: string, reason: string): never {
  throw new HarnessError("INTEGRITY", `${filePath} config key '${key}' ${reason}`);
}

export function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(record, key);
}
