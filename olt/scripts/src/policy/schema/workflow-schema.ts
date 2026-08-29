import { DEFAULT_PLANNING_POLICY, DEFAULT_REVIEW_PROTOCOL_POLICY } from "../generator/index.ts";
import type {
  LifecycleHooksConfig,
  PlanningPolicy,
  ReviewProtocolPolicy,
  TestRunnerPolicy,
} from "../types/index.ts";
import {
  assertAllowedKeys,
  integrity,
  isRecord,
  reqBool,
  reqInt,
  reqString,
} from "./primitives.ts";

const TEST_RUNNER_KEYS: ReadonlySet<string> = new Set([
  "default_command",
  "targeted_pattern",
  "full_suite_command",
  "timeout_ms",
]);

const REVIEW_PROTOCOL_KEYS: ReadonlySet<string> = new Set([
  "max_adversarial_pushes",
  "cognitive_pushes",
  "escalate_on_exhausted_adversarial",
]);

const PLANNING_KEYS: ReadonlySet<string> = new Set([
  "mandatory_brainstorming_rounds",
  "socratic_expansion_depth",
  "enforce_edge_case_matrix",
  "min_tasks_per_complex_prompt",
  "max_files_per_task",
  "reject_shallow_umbrella_compression",
  "max_task_duration_minutes",
  "parallel_subagent_sla_rule",
  "stage_on_subdomain_completion",
]);

const HOOKS_KEYS: ReadonlySet<string> = new Set([
  "on_phase_completion",
  "on_release_push",
  "on_task_completion",
  "on_wave_completion",
  "on_wave_complete",
  "on_error",
]);

export function parseTestRunner(raw: unknown, p: string): TestRunnerPolicy {
  if (raw === undefined) {
    return {
      default_command: "bun test",
      targeted_pattern: "bun test <path>",
      full_suite_command: "bun test",
    };
  }
  if (!isRecord(raw)) integrity(p, "must be an object");
  assertAllowedKeys(raw, TEST_RUNNER_KEYS, p);
  return {
    default_command: reqString(raw["default_command"], `${p}.default_command`),
    targeted_pattern: reqString(raw["targeted_pattern"], `${p}.targeted_pattern`),
    full_suite_command: reqString(raw["full_suite_command"], `${p}.full_suite_command`),
    ...(raw["timeout_ms"] !== undefined
      ? { timeout_ms: reqInt(raw["timeout_ms"], `${p}.timeout_ms`, 1) }
      : {}),
  };
}

export function parseReviewProtocol(raw: unknown, p: string): ReviewProtocolPolicy {
  if (!isRecord(raw)) integrity(p, "must be an object");
  assertAllowedKeys(raw, REVIEW_PROTOCOL_KEYS, p);

  const rawMax = raw["max_adversarial_pushes"] !== undefined
    ? raw["max_adversarial_pushes"]
    : DEFAULT_REVIEW_PROTOCOL_POLICY.max_adversarial_pushes;
  const maxAdv = reqInt(rawMax, `${p}.max_adversarial_pushes`, 1, 100);

  const rawCog = raw["cognitive_pushes"] !== undefined
    ? raw["cognitive_pushes"]
    : DEFAULT_REVIEW_PROTOCOL_POLICY.cognitive_pushes;
  const cog = reqInt(rawCog, `${p}.cognitive_pushes`, 0, maxAdv);
  if (cog > maxAdv) integrity(`${p}.cognitive_pushes`, "must not exceed max_adversarial_pushes");

  const defaultEsc = DEFAULT_REVIEW_PROTOCOL_POLICY.escalate_on_exhausted_adversarial !== undefined
    ? DEFAULT_REVIEW_PROTOCOL_POLICY.escalate_on_exhausted_adversarial
    : true;
  const esc = raw["escalate_on_exhausted_adversarial"] !== undefined
    ? reqBool(raw["escalate_on_exhausted_adversarial"], `${p}.escalate_on_exhausted_adversarial`)
    : defaultEsc;

  return {
    max_adversarial_pushes: maxAdv,
    cognitive_pushes: cog,
    escalate_on_exhausted_adversarial: esc,
  };
}

export function parsePlanning(raw: unknown, p: string): PlanningPolicy {
  if (!isRecord(raw)) integrity(p, "must be an object");
  assertAllowedKeys(raw, PLANNING_KEYS, p);

  const rawRounds = raw["mandatory_brainstorming_rounds"] !== undefined
    ? raw["mandatory_brainstorming_rounds"]
    : DEFAULT_PLANNING_POLICY.mandatory_brainstorming_rounds;
  const mandatory_brainstorming_rounds = reqInt(rawRounds, `${p}.mandatory_brainstorming_rounds`, 0, 100);

  const rawDepth = raw["socratic_expansion_depth"] !== undefined
    ? raw["socratic_expansion_depth"]
    : DEFAULT_PLANNING_POLICY.socratic_expansion_depth;
  const socratic_expansion_depth = reqInt(rawDepth, `${p}.socratic_expansion_depth`, 0, 100);

  const enforce_edge_case_matrix = raw["enforce_edge_case_matrix"] !== undefined
    ? reqBool(raw["enforce_edge_case_matrix"], `${p}.enforce_edge_case_matrix`)
    : DEFAULT_PLANNING_POLICY.enforce_edge_case_matrix;

  const rawMinTasks = raw["min_tasks_per_complex_prompt"] !== undefined
    ? raw["min_tasks_per_complex_prompt"]
    : DEFAULT_PLANNING_POLICY.min_tasks_per_complex_prompt;
  const min_tasks_per_complex_prompt = reqInt(rawMinTasks, `${p}.min_tasks_per_complex_prompt`, 1, 100);

  const rawMaxFiles = raw["max_files_per_task"] !== undefined
    ? raw["max_files_per_task"]
    : DEFAULT_PLANNING_POLICY.max_files_per_task;
  const max_files_per_task = reqInt(rawMaxFiles, `${p}.max_files_per_task`, 1, 100);

  const reject_shallow_umbrella_compression = raw["reject_shallow_umbrella_compression"] !== undefined
    ? reqBool(raw["reject_shallow_umbrella_compression"], `${p}.reject_shallow_umbrella_compression`)
    : DEFAULT_PLANNING_POLICY.reject_shallow_umbrella_compression;

  return {
    mandatory_brainstorming_rounds,
    socratic_expansion_depth,
    enforce_edge_case_matrix,
    min_tasks_per_complex_prompt,
    max_files_per_task,
    reject_shallow_umbrella_compression,
    ...(raw["max_task_duration_minutes"] !== undefined
      ? { max_task_duration_minutes: reqInt(raw["max_task_duration_minutes"], `${p}.max_task_duration_minutes`, 1) }
      : {}),
    ...(raw["parallel_subagent_sla_rule"] !== undefined
      ? { parallel_subagent_sla_rule: reqBool(raw["parallel_subagent_sla_rule"], `${p}.parallel_subagent_sla_rule`) }
      : {}),
    ...(raw["stage_on_subdomain_completion"] !== undefined
      ? { stage_on_subdomain_completion: reqBool(raw["stage_on_subdomain_completion"], `${p}.stage_on_subdomain_completion`) }
      : {}),
  };
}

export function parseCommandList(
  arr: unknown,
  key: "allowed_commands" | "forbidden_commands",
): readonly string[] | undefined {
  if (arr === undefined) return undefined;
  if (!Array.isArray(arr)) integrity(key, "must be an array of non-empty strings");
  const parsed: string[] = [];
  const seen = new Set<string>();
  for (const [i, c] of (arr as unknown[]).entries()) {
    const norm = reqString(c, `${key}[${i}]`);
    if (seen.has(norm)) integrity(`${key}[${i}]`, `duplicates '${norm}'`);
    seen.add(norm);
    parsed.push(norm);
  }
  return parsed;
}

function parseHookCommandList(arr: unknown, p: string): readonly string[] {
  if (!Array.isArray(arr)) integrity(p, "must be an array of non-empty strings");
  const parsed: string[] = [];
  for (const [i, c] of (arr as unknown[]).entries()) {
    parsed.push(reqString(c, `${p}[${i}]`));
  }
  return parsed;
}

export function parseHooks(raw: unknown, p: string): LifecycleHooksConfig {
  if (!isRecord(raw)) integrity(p, "must be an object");
  assertAllowedKeys(raw, HOOKS_KEYS, p);

  const rawWave = raw["on_wave_completion"] !== undefined ? raw["on_wave_completion"] : raw["on_wave_complete"];

  return {
    ...(raw["on_phase_completion"] !== undefined
      ? { on_phase_completion: parseHookCommandList(raw["on_phase_completion"], `${p}.on_phase_completion`) }
      : {}),
    ...(raw["on_release_push"] !== undefined
      ? { on_release_push: parseHookCommandList(raw["on_release_push"], `${p}.on_release_push`) }
      : {}),
    ...(raw["on_task_completion"] !== undefined
      ? { on_task_completion: parseHookCommandList(raw["on_task_completion"], `${p}.on_task_completion`) }
      : {}),
    ...(rawWave !== undefined
      ? {
          on_wave_completion: parseHookCommandList(rawWave, `${p}.on_wave_completion`),
          on_wave_complete: parseHookCommandList(rawWave, `${p}.on_wave_complete`),
        }
      : {}),
    ...(raw["on_error"] !== undefined
      ? { on_error: parseHookCommandList(raw["on_error"], `${p}.on_error`) }
      : {}),
  };
}
