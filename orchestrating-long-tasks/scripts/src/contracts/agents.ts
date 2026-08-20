import { isEvidenceClass, isEvidenced, type EvidenceClass, type Evidenced } from "./evidence.ts";
import { isJsonObject, isSafeInteger, type JsonObject, type JsonValue } from "./json.ts";
import { isAgentRole, type AgentRole } from "./packets.ts";
import {
  isCategoryExtras,
  isToolCategory,
  type CategoryExtras,
  type ToolCategory,
} from "./taxonomy.ts";

/**
 * A thinking budget the host actually knows about. "unknown" is a reportable answer — a host that
 * cannot see the budget says so explicitly instead of the ledger picking a plausible level.
 */
export type ThinkingLevel = "high" | "low" | "medium" | "unknown";

export const THINKING_LEVELS: readonly ThinkingLevel[] = ["low", "medium", "high", "unknown"];

/** Mirrors the graph's `ModelTier` vocabulary, plus the explicit "the host did not know" answer. */
export type AgentModelTier = "l" | "m" | "s" | "unknown" | "xs";

export const AGENT_MODEL_TIERS: readonly AgentModelTier[] = ["xs", "s", "m", "l", "unknown"];

export type AgentGrantStatus = "active" | "released";

/**
 * A tool as its reporter named it, filed under the generic category they declared for it. The name
 * is an open instance string and the category is the vocabulary; neither is ever read out of the
 * other, so a tool nobody categorised keeps its name and simply has no category.
 */
export interface AgentToolRef extends JsonObject {
  name: string;
  category?: ToolCategory;
  extras?: CategoryExtras;
}

export interface AgentToolUse extends AgentToolRef {
  evidence_class: EvidenceClass;
  first_reported_at: string;
}

/**
 * Two sources named the same field and disagreed. Nothing is thrown away to make room for a
 * winner: `recorded_value` is whichever value the grant field itself kept (an explicit report
 * always keeps the field), `probed_value` is what an independent read of the same field found
 * instead. Both carry their own evidence class — "who said so" is exactly what makes two
 * disagreeing numbers worth showing side by side rather than quietly picking one (B32.1, B39).
 */
export interface TelemetryFieldConflict extends JsonObject {
  field: string;
  recorded_value: JsonValue;
  recorded_evidence_class: EvidenceClass;
  probed_value: JsonValue;
  probed_evidence_class: EvidenceClass;
}

/**
 * One dispatched agent and everything the run knows about it. `id` is the agent id the harness will
 * later see as an event `actor`, which is what closes the loop between a grant and the work done
 * under it. Every telemetry field is optional and stays absent unless the host supplied it.
 */
export interface AgentGrantRecord extends JsonObject {
  id: string;
  role: AgentRole;
  parent_agent_id: null | string;
  parent_task_id: null | string;
  host: string;
  granted_at: string;
  status: AgentGrantStatus;
  released_at?: string;
  release_reason?: string;
  /** Who serves the model, as the host named it. Never read out of the model string. */
  provider?: Evidenced<string>;
  /** The model id exactly as the host reported it: never parsed, normalised or matched against. */
  model?: Evidenced<string>;
  model_tier?: Evidenced<AgentModelTier>;
  thinking_level?: Evidenced<ThinkingLevel>;
  context_window?: Evidenced<number>;
  tools_granted?: Evidenced<AgentToolRef[]>;
  tools_used?: AgentToolUse[];
  tokens_in?: Evidenced<number>;
  tokens_out?: Evidenced<number>;
  /**
   * Counters only some providers keep — cache reads, reasoning tokens, tool tokens — under the
   * names their host reported them by, so a host counting something unusual loses nothing.
   */
  token_extras?: Record<string, Evidenced<number>>;
  last_reported_at?: string;
  report_count?: number;
  /**
   * Every disagreement a probe ever found against an explicitly reported field, from registration
   * onward. Accumulated, never replaced — a disagreement a later probe stops reproducing was still
   * real at the time it was found, so it stays on the record rather than being pruned once it goes
   * quiet (B39).
   */
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
