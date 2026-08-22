import type { JsonObject } from "../contracts/json.ts";

const FORBIDDEN = new Set([
  "assumed_complete",
  "assumed_completion",
  "assumed_completions",
  "bulk_logs",
  "cognitive_questions",
  "cognitive_tree",
  "companion_manifest",
  "companion_manifests",
  "confidence",
  "debug_logs",
  "decision_narrative",
  "dependency_graph_dump",
  "diagnostic_dumps",
  "dom_metrics",
  "dom_physics",
  "dom_report",
  "error_blob",
  "error_blobs",
  "error_logs",
  "fake_completion",
  "fake_completions",
  "full_graph_dump",
  "giant_logs",
  "giant_payloads",
  "hallucinated_completion",
  "hallucinated_completions",
  "historical_completion",
  "historical_completions",
  "historical_events",
  "historical_report",
  "historical_reports",
  "implementer_report",
  "implementer_reports",
  "layout_shifts",
  "layout_shift_records",
  "previous_review",
  "previous_review_notes",
  "previous_reviews",
  "prior_completion_claim",
  "prior_completion_claims",
  "prior_review",
  "prior_reviews",
  "raw_errors",
  "raw_error_blob",
  "raw_error_blobs",
  "raw_events",
  "raw_event_log",
  "raw_metadata",
  "raw_telemetry",
  "report",
  "stack_trace",
  "stack_traces",
  "stale_evidence",
  "stale_pass",
  "task_report",
  "task_reports",
  "unfiltered_metadata",
  "unverified_success",
  "validator_report",
  "validator_reports",
  "visual_report",
]);

const VALIDATOR_ALLOWED = new Set([
  "baseline_repository_state",
  "command_evidence",
  "current_repository_state",
  "mapped_requirements",
  "original_prompt",
  "task_contract",
  "validation_round",
]);

const CRITIC_ALLOWED = new Set([
  "commands",
  "completion_readiness",
  "completion_result",
  "completion_review",
  "gates",
  "graph",
  "integrity_evidence",
  "orphan_evidence",
  "original_prompt",
  "plan_history",
  "repository_evidence",
  "requirements",
  "repository_state",
  "tasks",
]);

function normalizedKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .replace(/[^A-Za-z0-9]+/gu, "_")
    .toLowerCase()
    .replace(/^_+|_+$/gu, "");
}

function forbiddenKey(key: string): boolean {
  const normalized = normalizedKey(key);
  return (
    FORBIDDEN.has(normalized) ||
    /^(?:implementer|task|validator|historical)_reports?$/u.test(normalized) ||
    /^(?:previous|prior)_reviews?(?:_notes)?$/u.test(normalized) ||
    /^(?:assumed|fake|historical|prior|hallucinated)_completions?(?:_claims?)?$/u.test(normalized) ||
    /^(?:raw_events?|raw_event_logs?|raw_metadata|giant_logs?|error_logs?|debug_logs?|dependency_graph_dump|full_graph_dump|raw_errors?|raw_error_blobs?|error_blobs?|stack_traces?|diagnostic_dumps?|raw_telemetry|bulk_logs?|historical_events?|giant_payloads?|unfiltered_metadata)$/u.test(
      normalized,
    ) ||
    /^(?:unverified_success|stale_pass|stale_evidence)$/u.test(normalized)
  );
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !forbiddenKey(key))
      .map(([key, child]) => [key, sanitize(child)]),
  );
}

function allowContext(context: JsonObject, allowed: Set<string>): JsonObject {
  return Object.fromEntries(
    Object.entries(context)
      .filter(([key]) => allowed.has(key))
      .map(([key, value]) => [key, sanitize(value)]),
  ) as JsonObject;
}

export function isolateValidatorContext(context: JsonObject): JsonObject {
  return allowContext(context, VALIDATOR_ALLOWED);
}

export function excludeValidatorContamination(context: JsonObject): JsonObject {
  return sanitize(context) as JsonObject;
}

export function isolateCriticContext(context: JsonObject): JsonObject {
  return allowContext(context, CRITIC_ALLOWED);
}

export function sanitizeLeanContext(context: JsonObject): JsonObject {
  return sanitize(context) as JsonObject;
}

export const VALIDATOR_EXCLUSIONS = [...FORBIDDEN].sort();
