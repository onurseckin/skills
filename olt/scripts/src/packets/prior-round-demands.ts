import { isJsonObject, type JsonObject, type JsonValue } from "../contracts/json.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { isProbeDemand } from "../workflow/review/finding-class.ts";
import { requireText } from "../workflow/task-state.ts";
import type { TaskRecord } from "../workflow/types.ts";

const CONCLUSION_KEYS: ReadonlySet<string> = new Set([
  "assessment",
  "assumed_complete",
  "assumed_completion",
  "assumed_completions",
  "class",
  "conclusion",
  "confidence",
  "detail",
  "fake_completion",
  "fake_completions",
  "historical_completion",
  "historical_completions",
  "judgement",
  "judgment",
  "narrative",
  "observation",
  "opinion",
  "prior_completion_claim",
  "prior_completion_claims",
  "rationale",
  "recommendation",
  "remediation",
  "resolved_at",
  "resolved_by",
  "revalidation_proof",
  "review",
  "reviewed_requirement_ids",
  "severity",
  "stale_pass",
  "unverified_success",
  "validation_history",
  "verdict",
]);

export const CONCLUSION_EXCLUSIONS: string[] = [...CONCLUSION_KEYS].sort();

export interface ProveDemand extends JsonObject {
  demand_id: string;
  requirement_id: string;
  prove: string;
  prove_by?: string;
  look_at: JsonObject[];
  demanded_at?: string;
  probe_round?: number;
}

function withoutConclusions(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(withoutConclusions);
  if (!isJsonObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !CONCLUSION_KEYS.has(key))
      .map(([key, child]) => [key, withoutConclusions(child)]),
  );
}

export function stripConclusions<T extends JsonValue>(value: T): T {
  return withoutConclusions(value) as T;
}

export function assertNoConclusions(value: JsonValue, field: string): void {
  const offending = (node: JsonValue, path: string): string | undefined => {
    if (Array.isArray(node)) {
      for (const [index, child] of node.entries()) {
        const found = offending(child, `${path}[${index}]`);
        if (found) return found;
      }
      return undefined;
    }
    if (!isJsonObject(node)) return undefined;
    for (const [key, child] of Object.entries(node)) {
      if (CONCLUSION_KEYS.has(key)) return `${path}.${key}`;
      const found = offending(child, `${path}.${key}`);
      if (found) return found;
    }
    return undefined;
  };
  const found = offending(value, field);
  if (found) throw new HarnessError("INTEGRITY", `a prior conclusion reached the packet: ${found}`);
}

export function priorRoundDemands(task: TaskRecord): ProveDemand[] {
  return (task.findings ?? []).map((finding) => {
    const revalidation = requireText(
      finding.revalidation,
      `revalidation for ${String(finding.id)}`,
    );
    const demanded = isProbeDemand(finding)
      ? requireText(finding.observation, `demand text for ${String(finding.id)}`)
      : undefined;
    const demand: ProveDemand = {
      demand_id: requireText(finding.id, "finding.id"),
      requirement_id: requireText(finding.requirement_id, "finding.requirement_id"),
      prove: demanded ?? revalidation,
      ...(demanded ? { prove_by: revalidation } : {}),
      look_at: stripConclusions(finding.evidence ?? []),
    };
    if (typeof finding.demanded_at === "string") demand.demanded_at = finding.demanded_at;
    if (typeof finding.probe_round === "number") demand.probe_round = finding.probe_round;
    return demand;
  });
}

export function validatorTaskContract(contract: JsonObject, task?: TaskRecord): JsonObject {
  const stripped = stripConclusions(contract);
  const demands = task ? priorRoundDemands(task) : [];
  if (demands.length === 0) {
    delete stripped.findings;
    return stripped;
  }
  return { ...stripped, findings: demands };
}
