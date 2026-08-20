import type { JsonObject } from "../contracts/json.ts";

const FORBIDDEN = new Set([
  "confidence",
  "decision_narrative",
  "implementer_report",
  "implementer_reports",
  "previous_review",
  "previous_review_notes",
  "previous_reviews",
  "prior_review",
  "prior_reviews",
  "report",
  "task_report",
  "task_reports",
  "validator_report",
  "validator_reports",
]);

const VALIDATOR_ALLOWED = new Set([
  "baseline_repository_state",
  "command_evidence",
  "current_repository_state",
  "mapped_requirements",
  "original_prompt",
  "task_contract",
  // What the run already recorded about this task on earlier rounds: diffs, commands and the
  // demands still standing. Facts and demands only — the conclusions are stripped where it is built.
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
    /^(?:implementer|task|validator)_reports?$/u.test(normalized) ||
    /^(?:previous|prior)_reviews?(?:_notes)?$/u.test(normalized)
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

export const VALIDATOR_EXCLUSIONS = [...FORBIDDEN].sort();
