import { HarnessError } from "../core/errors/index.ts";
import { parseRepoPolicy } from "./schema/index.ts";
import {
  CURRENT_POLICY_SCHEMA_VERSION,
  type AgentPolicy,
  type LifecycleHooksConfig,
  type PlanningPolicy,
  type RepoPolicy,
  type ReviewProtocolPolicy,
} from "./types/index.ts";

export interface PolicyValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly policy?: RepoPolicy;
}

export function validatePolicy(raw: unknown): RepoPolicy {
  return parseRepoPolicy(raw);
}

export function assertValidPolicy(raw: unknown): asserts raw is RepoPolicy {
  parseRepoPolicy(raw);
}

export function isPolicyValid(raw: unknown): boolean {
  try {
    parseRepoPolicy(raw);
    return true;
  } catch {
    return false;
  }
}

export function validateCommandIntegrity(
  allowed?: readonly string[],
  forbidden?: readonly string[],
): readonly string[] {
  const errors: string[] = [];
  if (allowed && forbidden) {
    const allowedSet = new Set(allowed);
    for (const cmd of forbidden) {
      if (allowedSet.has(cmd)) {
        errors.push(`Command '${cmd}' is both allowed and forbidden`);
      }
    }
  }
  return errors;
}

export function validatePlanningPolicy(planning: unknown): readonly string[] {
  const errors: string[] = [];
  if (typeof planning !== "object" || planning === null) {
    errors.push("Planning policy must be an object");
    return errors;
  }
  const p = planning as Record<string, unknown>;
  if (
    typeof p["mandatory_brainstorming_rounds"] === "number" &&
    (!Number.isSafeInteger(p["mandatory_brainstorming_rounds"]) ||
      p["mandatory_brainstorming_rounds"] < 0)
  ) {
    errors.push("mandatory_brainstorming_rounds must be a non-negative integer");
  }
  if (
    typeof p["min_tasks_per_complex_prompt"] === "number" &&
    (!Number.isSafeInteger(p["min_tasks_per_complex_prompt"]) ||
      p["min_tasks_per_complex_prompt"] < 1)
  ) {
    errors.push("min_tasks_per_complex_prompt must be a positive integer >= 1");
  }
  if (
    typeof p["max_files_per_task"] === "number" &&
    (!Number.isSafeInteger(p["max_files_per_task"]) || p["max_files_per_task"] < 1)
  ) {
    errors.push("max_files_per_task must be a positive integer >= 1");
  }
  return errors;
}

export function validateReviewProtocol(review: unknown): readonly string[] {
  const errors: string[] = [];
  if (typeof review !== "object" || review === null) {
    errors.push("Review protocol must be an object");
    return errors;
  }
  const r = review as Record<string, unknown>;
  if (
    typeof r["max_adversarial_pushes"] === "number" &&
    (!Number.isSafeInteger(r["max_adversarial_pushes"]) || r["max_adversarial_pushes"] < 1)
  ) {
    errors.push("max_adversarial_pushes must be a positive integer >= 1");
  }
  if (
    typeof r["cognitive_pushes"] === "number" &&
    (!Number.isSafeInteger(r["cognitive_pushes"]) || r["cognitive_pushes"] < 0)
  ) {
    errors.push("cognitive_pushes must be a non-negative integer");
  }
  return errors;
}

export function validateHooksIntegrity(hooks: unknown): readonly string[] {
  const errors: string[] = [];
  if (typeof hooks !== "object" || hooks === null) {
    errors.push("Hooks must be an object");
    return errors;
  }
  const h = hooks as Record<string, unknown>;
  for (const [key, value] of Object.entries(h)) {
    if (value !== undefined && !Array.isArray(value)) {
      errors.push(`Hook '${key}' must be an array of strings`);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item !== "string" || item.trim().length === 0) {
          errors.push(`Hook '${key}' entries must be non-empty strings`);
        }
      }
    }
  }
  return errors;
}

export function validatePolicyStructure(raw: unknown): PolicyValidationResult {
  try {
    const policy = parseRepoPolicy(raw);
    return { valid: true, errors: [], policy };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { valid: false, errors: [msg] };
  }
}
