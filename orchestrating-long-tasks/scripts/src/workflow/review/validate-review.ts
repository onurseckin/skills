import { HarnessError } from "../../errors/harness-error.ts";
import type { Finding } from "../../contracts/workflow.ts";
import type { JsonObject } from "../../contracts/json.ts";
import { loadChecklist, type ValidatorDomain } from "../../packets/role-contract.ts";
import { requireSubstantiveObjects } from "../evidence.ts";
import { jsonCopy, requireText, taskRequirements } from "../task-state.ts";
import type { CommandProof, TaskRecord } from "../types.ts";
import { findingClassOf, isFindingClass, type FindingClass } from "./finding-class.ts";

const SEVERITIES = new Set(["critical", "important", "minor"]);

function isSeverity(value: unknown): value is "critical" | "important" | "minor" {
  return typeof value === "string" && SEVERITIES.has(value);
}

export interface ReviewInput extends JsonObject {
  verdict: "pass" | "reject";
  requirement_ids: string[];
  checks: CommandProof[];
  findings: Finding[];
  resolved_findings?: RevalidationProof[];
}

export interface RevalidationProof extends JsonObject {
  finding_id: string;
  method: string;
  evidence: CommandProof[];
}

export interface FindingClassRule {
  /** Every finding must declare exactly this class. */
  readonly required?: FindingClass;
  /** This class may not appear, whatever the finding says. */
  readonly forbidden?: FindingClass;
}

function commandProofs(value: unknown, field: string): CommandProof[] {
  const objects = requireSubstantiveObjects(value, field);
  const seen = new Set<string>();
  return objects.map((proof) => {
    const commandId = requireText(proof.command_id, `${field}.command_id`);
    if (seen.has(commandId))
      throw new HarnessError("INVALID_ARGUMENT", `${field} contains duplicate ${commandId}`);
    seen.add(commandId);
    return { command_id: commandId };
  });
}

function validateResolutions(value: unknown): RevalidationProof[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new HarnessError("INVALID_ARGUMENT", "resolved_findings must be an array");
  }
  const ids = new Set<string>();
  return value.map((raw) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new HarnessError("INVALID_ARGUMENT", "revalidation proof must be an object");
    }
    const proof = raw as Record<string, unknown>;
    const findingId = requireText(proof.finding_id, "revalidation.finding_id");
    if (ids.has(findingId))
      throw new HarnessError("INVALID_ARGUMENT", `duplicate resolution: ${findingId}`);
    ids.add(findingId);
    const method = requireText(proof.method, "revalidation.method");
    const evidence = commandProofs(proof.evidence, `revalidation evidence for ${findingId}`);
    return jsonCopy({
      finding_id: findingId,
      method,
      evidence,
    } as RevalidationProof);
  });
}

function assertFindingClass(finding: Finding, id: string, rule: FindingClassRule): void {
  if (finding.class !== undefined && !isFindingClass(finding.class)) {
    throw new HarnessError("INVALID_ARGUMENT", `finding ${id} declares an unknown class`);
  }
  const declared = findingClassOf(finding);
  if (rule.required && declared !== rule.required) {
    throw new HarnessError("INVALID_ARGUMENT", `finding ${id} must declare class ${rule.required}`);
  }
  if (rule.forbidden && declared === rule.forbidden) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `finding ${id} declares class ${rule.forbidden}, which this verdict cannot carry`,
    );
  }
}

/**
 * Shared by rejections and probes: both push findings onto the task, so both must prove the finding
 * is substantive, uniquely identified and bound to a requirement the task actually owns.
 */
export function validateFindings(task: TaskRecord, value: unknown, rule: FindingClassRule): void {
  if (!Array.isArray(value)) {
    throw new HarnessError("INVALID_ARGUMENT", "findings must be an array");
  }
  const expected = taskRequirements(task);
  const ids = new Set<string>();
  const historicalIds = new Set((task.findings ?? []).map((finding) => finding.id));
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new HarnessError("INVALID_ARGUMENT", "finding must be an object");
    }
    const finding = raw as unknown as Finding;
    const id = requireText(finding.id, "finding.id");
    if (ids.has(id)) throw new HarnessError("INVALID_ARGUMENT", `duplicate finding: ${id}`);
    if (historicalIds.has(id))
      throw new HarnessError("INVALID_ARGUMENT", `finding ID already exists: ${id}`);
    ids.add(id);
    if (
      !expected.has(finding.requirement_id) ||
      !SEVERITIES.has(finding.severity) ||
      !Array.isArray(finding.evidence)
    ) {
      throw new HarnessError("INVALID_ARGUMENT", `invalid finding: ${id}`);
    }
    assertFindingClass(finding, id, rule);
    requireSubstantiveObjects(finding.evidence, `finding evidence for ${id}`);
    requireText(finding.observation, "finding.observation");
    requireText(finding.remediation, "finding.remediation");
    requireText(finding.revalidation, "finding.revalidation");
  }
}

export function validateReview(task: TaskRecord, value: unknown): ReviewInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HarnessError("INVALID_ARGUMENT", "review must be an object");
  }
  const review = value as Record<string, unknown>;
  if (review.verdict !== "pass" && review.verdict !== "reject") {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "review verdict must be pass or reject; a probe is recorded with task:probe",
    );
  }
  const expected = taskRequirements(task);
  const reviewed = review.requirement_ids;
  if (
    !Array.isArray(reviewed) ||
    reviewed.some((id) => typeof id !== "string") ||
    reviewed.length !== expected.size ||
    new Set(reviewed as string[]).size !== reviewed.length ||
    (reviewed as string[]).some((id) => !expected.has(id))
  ) {
    throw new HarnessError("INVALID_ARGUMENT", "review must cover every task requirement");
  }
  const checks = commandProofs(review.checks, "independent checks");
  if (!Array.isArray(review.findings))
    throw new HarnessError("INVALID_ARGUMENT", "findings must be an array");
  if (review.verdict === "reject" && review.findings.length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "a rejected review requires findings");
  }
  validateFindings(task, review.findings, { forbidden: "probe_demand" });
  const resolvedFindings = validateResolutions(review.resolved_findings);
  return jsonCopy({
    verdict: review.verdict,
    requirement_ids: review.requirement_ids,
    checks,
    findings: review.findings,
    ...(resolvedFindings.length === 0 ? {} : { resolved_findings: resolvedFindings }),
  } as ReviewInput);
}

// --- B12.5: checklist coverage -------------------------------------------------------------
//
// A validator report states, separately from the task's own pass/fail finding: every standing
// checklist item it checked and passed, every item it found not applicable (with why), every item
// it could not check (with why), and any standing-standard violation it found outside the task's
// own write scope (an "adjacent" finding — B12.1). None of this gates the task's verdict; a task
// passes or fails on its own requirements exactly as before. This is the report showing what was
// actually inspected, so B33's rule applies here as much as anywhere: an item silently missing from
// every bucket is the same failure mode as a fabricated pass.

/** One standing-checklist item's disposition for this review (B12.5). */
export type ChecklistDisposition = "checked" | "not_applicable" | "could_not_check";

const CHECKLIST_DISPOSITIONS = new Set<string>(["checked", "not_applicable", "could_not_check"]);

function isChecklistDisposition(value: unknown): value is ChecklistDisposition {
  return typeof value === "string" && CHECKLIST_DISPOSITIONS.has(value);
}

export interface ChecklistCoverageEntry extends JsonObject {
  /** The checklist item's own id, e.g. `CQ-STRUCT-001` (B12.3). */
  id: string;
  disposition: ChecklistDisposition;
  /** Required for every disposition but `checked`: the reason an item was skipped is itself part
   *  of the coverage, not an optional footnote. */
  reason?: string;
}

/** A standing-standard violation found outside the task's own write scope (B12.1). It informs the
 *  coordinator and does not gate this task's verdict — routing it to repair or the backlog is a
 *  decision for whoever reads the report, not this validation step. */
export interface AdjacentFinding extends JsonObject {
  id: string;
  checklist_item_id: string;
  severity: "critical" | "important" | "minor";
  observation: string;
  remediation: string;
  evidence: JsonObject[];
}

export interface ChecklistCoverageReport extends JsonObject {
  domain: ValidatorDomain;
  items: ChecklistCoverageEntry[];
  adjacent_findings: AdjacentFinding[];
}

function validateCoverageEntry(
  raw: unknown,
  index: number,
  expectedIds: ReadonlySet<string>,
  seen: Set<string>,
): ChecklistCoverageEntry {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new HarnessError("INVALID_ARGUMENT", `checklist_coverage.items[${index}] must be an object`);
  }
  const entry = raw as Record<string, unknown>;
  const id = requireText(entry.id, `checklist_coverage.items[${index}].id`);
  if (!expectedIds.has(id)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `checklist_coverage.items references an item this checklist does not declare: ${id}`,
    );
  }
  if (seen.has(id)) {
    throw new HarnessError("INVALID_ARGUMENT", `checklist_coverage.items reports ${id} more than once`);
  }
  seen.add(id);
  if (!isChecklistDisposition(entry.disposition)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `${id}: disposition must be checked, not_applicable or could_not_check`,
    );
  }
  if (entry.disposition === "checked") return jsonCopy({ id, disposition: entry.disposition });
  const reason = requireText(entry.reason, `checklist_coverage item ${id}.reason`);
  return jsonCopy({ id, disposition: entry.disposition, reason });
}

function validateAdjacentFinding(
  raw: unknown,
  index: number,
  expectedIds: ReadonlySet<string>,
  seen: Set<string>,
): AdjacentFinding {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new HarnessError("INVALID_ARGUMENT", `adjacent_findings[${index}] must be an object`);
  }
  const finding = raw as Record<string, unknown>;
  const id = requireText(finding.id, `adjacent_findings[${index}].id`);
  if (seen.has(id)) throw new HarnessError("INVALID_ARGUMENT", `duplicate adjacent finding: ${id}`);
  seen.add(id);
  const checklistItemId = requireText(finding.checklist_item_id, `${id}.checklist_item_id`);
  if (!expectedIds.has(checklistItemId)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `adjacent finding ${id} cites an item this checklist does not declare: ${checklistItemId}`,
    );
  }
  if (!isSeverity(finding.severity)) {
    throw new HarnessError("INVALID_ARGUMENT", `adjacent finding ${id}: invalid severity`);
  }
  const observation = requireText(finding.observation, `${id}.observation`);
  const remediation = requireText(finding.remediation, `${id}.remediation`);
  const evidence = requireSubstantiveObjects(finding.evidence, `adjacent finding ${id} evidence`);
  return jsonCopy({
    id,
    checklist_item_id: checklistItemId,
    severity: finding.severity,
    observation,
    remediation,
    evidence,
  });
}

/**
 * B12.5's coverage requirement: every item the domain's standing checklist declares must land in
 * exactly one disposition bucket, so the report shows what was actually inspected rather than
 * implying full coverage from whatever subset a validator happened to list. `domain` selects which
 * checklist governs — the same closed set `task:validate-start --validator-domain` draws from
 * (B12.2) — so a coverage report is always checked against a real, versioned document, never a
 * list of items a caller invented for the occasion.
 */
export function validateChecklistCoverage(
  domain: ValidatorDomain,
  value: unknown,
): ChecklistCoverageReport {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HarnessError("INVALID_ARGUMENT", "checklist coverage must be an object");
  }
  const raw = value as Record<string, unknown>;
  const checklist = loadChecklist(domain);
  const expectedIds = new Set(checklist.items.map((item) => item.id));

  if (!Array.isArray(raw.items)) {
    throw new HarnessError("INVALID_ARGUMENT", "checklist_coverage.items must be an array");
  }
  const seenItems = new Set<string>();
  const items = raw.items.map((entry, index) =>
    validateCoverageEntry(entry, index, expectedIds, seenItems),
  );
  const missing = [...expectedIds].filter((id) => !seenItems.has(id));
  if (missing.length > 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `checklist coverage omits ${missing.length} item(s) of ${checklist.title}: ${missing.sort().join(", ")}`,
    );
  }

  const adjacentRaw = raw.adjacent_findings ?? [];
  if (!Array.isArray(adjacentRaw)) {
    throw new HarnessError("INVALID_ARGUMENT", "adjacent_findings must be an array");
  }
  const seenAdjacent = new Set<string>();
  const adjacentFindings = adjacentRaw.map((entry, index) =>
    validateAdjacentFinding(entry, index, expectedIds, seenAdjacent),
  );

  return jsonCopy({ domain, items, adjacent_findings: adjacentFindings });
}
