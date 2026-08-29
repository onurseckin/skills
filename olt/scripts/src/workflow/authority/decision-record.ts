import { canonicalJsonBytes, sha256Bytes } from "../../core/json.ts";
import type { JsonObject } from "../../core/contracts/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { isRecord } from "../../requirements/predicates.ts";
import type { AuthorityRequirementRecord } from "./authorization.ts";
import type { AuthorityDecisionInput, AuthorityDecisionRecord } from "./types.ts";

export function decisionHistory(
  requirement: AuthorityRequirementRecord,
): AuthorityDecisionRecord[] {
  const value = requirement.authority_history;
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(isRecord)) {
    throw new HarnessError("INVALID_STATE", "requirement authority_history must be an object list");
  }
  return value as AuthorityDecisionRecord[];
}

export function makeAuthorityDecisionRecord(
  requirementId: string,
  actor: string,
  input: AuthorityDecisionInput,
  decidedAt: string,
): AuthorityDecisionRecord {
  const resultingDisposition = input.decision === "grant" ? "actionable" : "out_of_scope";
  const content: JsonObject = {
    requirement_id: requirementId,
    decision: input.decision,
    actor,
    rationale: input.rationale,
    decided_at: decidedAt,
    prior_disposition: "needs_authority",
    resulting_disposition: resultingDisposition,
  };
  const digest = sha256Bytes(canonicalJsonBytes(content));
  return {
    decision_id: `authority-${digest.slice(0, 20)}`,
    ...content,
    decision_sha256: digest,
  } as AuthorityDecisionRecord;
}
