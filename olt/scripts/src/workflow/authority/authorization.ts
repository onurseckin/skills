import { isRecord } from "../../requirements/predicates.ts";
import { canonicalJsonBytes, sha256Bytes } from "../../core/json.ts";
import type { JsonObject } from "../../contracts/json.ts";

export type RequirementDisposition = "actionable" | "needs_authority" | "out_of_scope";

export interface AuthorityRequirementRecord extends Record<string, unknown> {
  id: string;
  disposition?: RequirementDisposition;
  authority_status?: "granted" | "declined";
  dependencies?: string[];
}

function requirementValues(state: unknown): unknown[] {
  if (!isRecord(state)) return [];
  if (Array.isArray(state.requirements)) return state.requirements;
  if (isRecord(state.requirements) && Array.isArray(state.requirements.requirements)) {
    return state.requirements.requirements;
  }
  return [];
}

export function authorityRequirements(state: unknown): Map<string, AuthorityRequirementRecord> {
  const values = requirementValues(state);
  const records = values.filter(
    (value): value is AuthorityRequirementRecord => isRecord(value) && typeof value.id === "string",
  );
  return new Map(records.map((requirement) => [requirement.id, requirement]));
}

export function requirementDisposition(
  requirement: AuthorityRequirementRecord,
): RequirementDisposition | "invalid" {
  const value = requirement.disposition;
  return value === "actionable" || value === "needs_authority" || value === "out_of_scope"
    ? value
    : "invalid";
}

export function authorityAuditIssues(requirement: AuthorityRequirementRecord): string[] {
  const status = requirement.authority_status;
  const history = requirement.authority_history;
  if (status === undefined && history === undefined) return [];
  if (status !== "granted" && status !== "declined") return ["authority_status is invalid"];
  if (!Array.isArray(history) || history.length !== 1 || !isRecord(history[0])) {
    return ["authority_history must contain exactly one decision record"];
  }
  const record = history[0];
  const decision = status === "granted" ? "grant" : "decline";
  const resulting = status === "granted" ? "actionable" : "out_of_scope";
  if (
    record.requirement_id !== requirement.id ||
    record.decision !== decision ||
    record.prior_disposition !== "needs_authority" ||
    record.resulting_disposition !== resulting ||
    typeof record.actor !== "string" ||
    record.actor.trim() === "" ||
    typeof record.rationale !== "string" ||
    record.rationale.trim() === "" ||
    typeof record.decided_at !== "string" ||
    Number.isNaN(Date.parse(record.decided_at))
  ) {
    return ["authority decision record does not match the requirement authority state"];
  }
  const content: JsonObject = {
    requirement_id: record.requirement_id,
    decision,
    actor: record.actor,
    rationale: record.rationale,
    decided_at: record.decided_at,
    prior_disposition: "needs_authority",
    resulting_disposition: resulting,
  };
  const digest = sha256Bytes(canonicalJsonBytes(content));
  if (
    record.decision_sha256 !== digest ||
    record.decision_id !== `authority-${digest.slice(0, 20)}`
  ) {
    return ["authority decision digest is invalid"];
  }
  return [];
}

export function effectiveRequirementDisposition(
  requirement: AuthorityRequirementRecord,
): RequirementDisposition | "invalid" {
  const planned = requirementDisposition(requirement);
  if (planned === "out_of_scope") return "invalid";
  if (planned !== "needs_authority") return planned;
  if (authorityAuditIssues(requirement).length > 0) return "invalid";
  if (requirement.authority_status === "granted") return "actionable";
  if (requirement.authority_status === "declined") return "out_of_scope";
  return "needs_authority";
}

export function authorizedRequirementIds(state: unknown): Set<string> {
  const entries = authorityRequirements(state);
  const authorized = new Set(
    [...entries]
      .filter(([, requirement]) => effectiveRequirementDisposition(requirement) === "actionable")
      .map(([id]) => id),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...authorized]) {
      const dependencies = entries.get(id)?.dependencies ?? [];
      if (!Array.isArray(dependencies) || dependencies.some((value) => !authorized.has(value))) {
        authorized.delete(id);
        changed = true;
      }
    }
  }
  return authorized;
}
