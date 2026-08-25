import { isEvidenceClass, isEvidenced, type EvidenceClass, type Evidenced } from "./evidence.ts";
import { isJsonObject, isSafeInteger, type JsonObject, type JsonValue } from "./json.ts";
import { isAgentRole, type AgentRole } from "./packets.ts";
import {
  isCategoryExtras,
  isToolCategory,
  type CategoryExtras,
  type ToolCategory,
} from "./taxonomy.ts";

export type ThinkingLevel = "high" | "low" | "medium" | "unknown" | "xhigh";

export const THINKING_LEVELS: readonly ThinkingLevel[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "unknown",
];

export type AgentModelTier = "l" | "m" | "s" | "unknown" | "xs";

export const AGENT_MODEL_TIERS: readonly AgentModelTier[] = ["xs", "s", "m", "l", "unknown"];

export type AgentGrantStatus = "active" | "released";

export interface AgentToolRef extends JsonObject {
  name: string;
  category?: ToolCategory;
  extras?: CategoryExtras;
}

export interface AgentToolUse extends AgentToolRef {
  evidence_class: EvidenceClass;
  first_reported_at: string;
}

export interface TelemetryFieldConflict extends JsonObject {
  field: string;
  recorded_value: JsonValue;
  recorded_evidence_class: EvidenceClass;
  probed_value: JsonValue;
  probed_evidence_class: EvidenceClass;
}

export interface AgentGrantRecord extends JsonObject {
  id: string;
  role: AgentRole;
  parent_agent_id: null | string;
  parent_task_id: null | string;
  host: string;
  granted_at: string;
  status: AgentGrantStatus;
  // `id` lives in the harness actor namespace, which no host can route a message to;
  // `host_address` is the same agent's address in the spawning host's own namespace.
  host_address?: string;
  released_at?: string;
  release_reason?: string;
  provider?: Evidenced<string>;
  model?: Evidenced<string>;
  model_tier?: Evidenced<AgentModelTier>;
  thinking_level?: Evidenced<ThinkingLevel>;
  context_window?: Evidenced<number>;
  tools_granted?: Evidenced<AgentToolRef[]>;
  tools_used?: AgentToolUse[];
  tokens_in?: Evidenced<number>;
  tokens_out?: Evidenced<number>;
  token_extras?: Record<string, Evidenced<number>>;
  last_reported_at?: string;
  report_count?: number;
  telemetry_conflicts?: TelemetryFieldConflict[];
}

const THINKING_LEVEL_SET = new Set<string>(THINKING_LEVELS);
const MODEL_TIER_SET = new Set<string>(AGENT_MODEL_TIERS);
const GRANT_STATUSES = new Set<string>(["active", "released"]);

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && THINKING_LEVEL_SET.has(value);
}

export function isAgentModelTier(value: unknown): value is AgentModelTier {
  return typeof value === "string" && MODEL_TIER_SET.has(value);
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNullableId(value: unknown): value is null | string {
  return value === null || isNonBlankString(value);
}

function optionalString(record: JsonObject, key: string): boolean {
  const value = record[key];
  return value === undefined || isNonBlankString(value);
}

function optionalEvidenced<T>(
  record: JsonObject,
  key: string,
  isValue: (candidate: unknown) => candidate is T,
): boolean {
  const value = record[key];
  return value === undefined || isEvidenced(value, isValue);
}

export function isAgentToolRef(value: unknown): value is AgentToolRef {
  if (!isJsonObject(value)) return false;
  if (!isNonBlankString(value.name)) return false;
  if (value.category !== undefined && !isToolCategory(value.category)) return false;
  if (value.extras !== undefined && !isCategoryExtras(value.extras)) return false;
  return true;
}

function isAgentToolRefArray(value: unknown): value is AgentToolRef[] {
  return Array.isArray(value) && value.every(isAgentToolRef);
}

function isAgentToolUse(value: unknown): value is AgentToolUse {
  return (
    isAgentToolRef(value) &&
    isEvidenceClass((value as JsonObject).evidence_class) &&
    isNonBlankString((value as JsonObject).first_reported_at)
  );
}

function isEvidencedCounterMap(value: unknown): value is Record<string, Evidenced<number>> {
  if (!isJsonObject(value)) return false;
  return Object.values(value).every((entry) => isEvidenced(entry, isSafeInteger));
}

export function isTelemetryFieldConflict(value: unknown): value is TelemetryFieldConflict {
  if (!isJsonObject(value)) return false;
  if (!isNonBlankString(value.field)) return false;
  if (value.recorded_value === undefined || value.probed_value === undefined) return false;
  if (!isEvidenceClass(value.recorded_evidence_class)) return false;
  if (!isEvidenceClass(value.probed_evidence_class)) return false;
  return true;
}

function isTelemetryFieldConflictArray(value: unknown): value is TelemetryFieldConflict[] {
  return Array.isArray(value) && value.every(isTelemetryFieldConflict);
}

export function isAgentGrantRecord(value: unknown): value is AgentGrantRecord {
  if (!isJsonObject(value)) return false;
  if (!isNonBlankString(value.id) || !isAgentRole(value.role)) return false;
  if (!isNullableId(value.parent_agent_id) || !isNullableId(value.parent_task_id)) return false;
  if (!isNonBlankString(value.host) || !isNonBlankString(value.granted_at)) return false;
  if (typeof value.status !== "string" || !GRANT_STATUSES.has(value.status)) return false;
  if (!optionalString(value, "released_at") || !optionalString(value, "release_reason")) {
    return false;
  }
  if (!optionalString(value, "host_address")) return false;
  if (!optionalString(value, "last_reported_at")) return false;
  if (value.report_count !== undefined && !isSafeInteger(value.report_count)) return false;
  if (!optionalEvidenced(value, "provider", isNonBlankString)) return false;
  if (!optionalEvidenced(value, "model", isNonBlankString)) return false;
  if (!optionalEvidenced(value, "model_tier", isAgentModelTier)) return false;
  if (!optionalEvidenced(value, "thinking_level", isThinkingLevel)) return false;
  if (!optionalEvidenced(value, "context_window", isSafeInteger)) return false;
  if (!optionalEvidenced(value, "tools_granted", isAgentToolRefArray)) return false;
  if (!optionalEvidenced(value, "tokens_in", isSafeInteger)) return false;
  if (!optionalEvidenced(value, "tokens_out", isSafeInteger)) return false;
  if (value.token_extras !== undefined && !isEvidencedCounterMap(value.token_extras)) return false;
  const tools = value.tools_used;
  if (tools !== undefined && !(Array.isArray(tools) && tools.every(isAgentToolUse))) return false;
  if (
    value.telemetry_conflicts !== undefined &&
    !isTelemetryFieldConflictArray(value.telemetry_conflicts)
  ) {
    return false;
  }
  return true;
}
