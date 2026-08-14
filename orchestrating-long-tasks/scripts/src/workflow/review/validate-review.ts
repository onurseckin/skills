import { HarnessError } from "../../errors/harness-error.ts";
import type { Finding } from "../../contracts/workflow.ts";
import type { JsonObject } from "../../contracts/json.ts";
import { requireSubstantiveObjects } from "../evidence.ts";
import { jsonCopy, requireText, taskRequirements } from "../task-state.ts";
import type { CommandProof, TaskRecord } from "../types.ts";

const SEVERITIES = new Set(["critical", "important", "minor"]);

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

export function validateReview(task: TaskRecord, value: unknown): ReviewInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HarnessError("INVALID_ARGUMENT", "review must be an object");
  }
  const review = value as Record<string, unknown>;
  if (review.verdict !== "pass" && review.verdict !== "reject") {
    throw new HarnessError("INVALID_ARGUMENT", "review verdict must be pass or reject");
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
  const ids = new Set<string>();
  const historicalIds = new Set((task.findings ?? []).map((finding) => finding.id));
  for (const raw of review.findings) {
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
    requireSubstantiveObjects(finding.evidence, `finding evidence for ${id}`);
    requireText(finding.observation, "finding.observation");
    requireText(finding.remediation, "finding.remediation");
    requireText(finding.revalidation, "finding.revalidation");
  }
  const resolvedFindings = validateResolutions(review.resolved_findings);
  return jsonCopy({
    verdict: review.verdict,
    requirement_ids: review.requirement_ids,
    checks,
    findings: review.findings,
    ...(resolvedFindings.length === 0 ? {} : { resolved_findings: resolvedFindings }),
  } as ReviewInput);
}
