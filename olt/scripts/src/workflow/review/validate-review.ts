import { HarnessError } from "../../core/errors/index.ts";
import type { Finding } from "../../core/contracts/index.ts";
import type { JsonObject } from "../../core/contracts/index.ts";
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
  readonly required?: FindingClass;
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

  if (review.verdict === "pass") {
    if (expected.size > 1 && checks.length < expected.size) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `anti-batching violation: passing review covers ${expected.size} requirements but only provides ${checks.length} check(s); individual discriminating test proofs required per item`,
      );
    }
    if (resolvedFindings.length > 0) {
      for (const proof of resolvedFindings) {
        if (!proof.evidence || proof.evidence.length === 0) {
          throw new HarnessError(
            "INVALID_ARGUMENT",
            `anti-batching violation: resolved finding ${proof.finding_id} must carry individual discriminating command evidence`,
          );
        }
      }
    }
  }

  return jsonCopy({
    verdict: review.verdict,
    requirement_ids: review.requirement_ids,
    checks,
    findings: review.findings,
    ...(resolvedFindings.length === 0 ? {} : { resolved_findings: resolvedFindings }),
  } as ReviewInput);
}

export {
  validateChecklistCoverage,
  type AdjacentFinding,
  type ChecklistCoverageEntry,
  type ChecklistCoverageReport,
  type ChecklistDisposition,
} from "./checklist/index.ts";

