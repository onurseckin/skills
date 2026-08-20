import { isJsonObject, type JsonObject, type JsonValue } from "../contracts/json.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { isProbeDemand } from "../workflow/review/finding-class.ts";
import { requireText } from "../workflow/task-state.ts";
import type { TaskRecord } from "../workflow/types.ts";

/**
 * Keys that carry somebody's conclusion rather than something the run measured. A validator that
 * reads "round 1 concluded the parser drops rows" inherits that conclusion and stops looking; a
 * validator that reads "prove the parser keeps every row" looks. Both sentences point at the same
 * code, and only the second leaves the judgement where it belongs, so the conclusion-bearing keys
 * are removed from anything a prior round recorded before a fresh validator ever sees it.
 */
const CONCLUSION_KEYS: ReadonlySet<string> = new Set([
  "assessment",
  "class",
  "conclusion",
  "confidence",
  // Evidence a finding could not attach to a command carries the diagnosis in `detail`; the demand
  // it belongs to is already carried in full, so the restatement is dropped with the rest.
  "detail",
  "judgement",
  "judgment",
  "narrative",
  "observation",
  "opinion",
  "rationale",
  "recommendation",
  "remediation",
  "resolved_at",
  "resolved_by",
  "revalidation_proof",
  "review",
  "reviewed_requirement_ids",
  "severity",
  "validation_history",
  "verdict",
]);

/**
 * The field names a validation packet withholds because they carry a conclusion. Declared in the
 * packet's own metadata, so the packet says what it kept from its reader instead of leaving the
 * absence to be discovered.
 */
export const CONCLUSION_EXCLUSIONS: string[] = [...CONCLUSION_KEYS].sort();

export interface ProveDemand extends JsonObject {
  /** The recorded finding id, so a later review can answer this demand by name. */
  demand_id: string;
  requirement_id: string;
  /** What has to be shown to hold, in the words the round that raised it recorded. */
  prove: string;
  /** The check that settles it, when the demand recorded one separately from what it asks. */
  prove_by?: string;
  /** Where the demand pointed: locations only, with every conclusion-bearing key removed. */
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

/** Every conclusion-bearing key removed, at any depth. */
export function stripConclusions<T extends JsonValue>(value: T): T {
  return withoutConclusions(value) as T;
}

/**
 * The refusal behind the rule. Rendering runs this over everything a prior round contributes, so a
 * verdict that reached the packet by any route — a hand-built context, a field added upstream —
 * stops the packet instead of quietly anchoring the validator who reads it.
 */
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

/**
 * The demands earlier rounds put on record, re-expressed as what they ask to be proven. A finding
 * with no recorded re-validation is refused rather than carried as prose: the demand is the check,
 * and a demand nobody can run is the anchoring the rest of this module exists to prevent.
 *
 * A probe demand asserts nothing about the code — its observation is the demand itself — so that is
 * what it asks to be proven, and the re-validation instruction rides along as how to prove it. A
 * defect's observation is a diagnosis, so only the instruction survives.
 */
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

/**
 * The task contract as a validator may see it: the findings replaced by the demands they carry, and
 * every prior verdict — the validation history, the recorded verdict on this attempt — gone. The
 * facts of the attempt (who is validating, when it started, the deadline) stay, because they are
 * measurements of this round rather than an opinion about the last one.
 */
export function validatorTaskContract(contract: JsonObject, task?: TaskRecord): JsonObject {
  const stripped = stripConclusions(contract);
  const demands = task ? priorRoundDemands(task) : [];
  if (demands.length === 0) {
    delete stripped.findings;
    return stripped;
  }
  return { ...stripped, findings: demands };
}
