import type { JsonObject } from "../../contracts/json.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { requireSubstantiveObjects } from "../evidence.ts";
import { requirementExecutionState } from "../authority/index.ts";
import { requireText } from "../task-state.ts";
import type {
  CompletionEvidenceItem,
  CompletionFinding,
  CompletionRequirementProof,
  CompletionResidualRisk,
  WorkflowState,
} from "../types.ts";

const SEVERITIES = new Set(["critical", "important", "minor"]);

function uniqueObjects(value: unknown, field: string): JsonObject[] {
  return requireSubstantiveObjects(value, field);
}

function findingList(state: WorkflowState, value: unknown): CompletionFinding[] {
  if (!Array.isArray(value))
    throw new HarnessError("INVALID_ARGUMENT", "findings must be an array");
  const known = new Set(state.requirements.map(({ id }) => id));
  const historical = new Set(
    (state.completion_reviews ?? []).flatMap((review) =>
      (review.findings ?? []).map(({ id }) => id),
    ),
  );
  const seen = new Set<string>();
  return value.map((raw) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
      throw new HarnessError("INVALID_ARGUMENT", "completion finding must be an object");
    const finding = raw as Record<string, unknown>;
    const id = requireText(finding.id, "finding.id");
    if (seen.has(id)) throw new HarnessError("INVALID_ARGUMENT", `duplicate finding: ${id}`);
    if (historical.has(id))
      throw new HarnessError("INVALID_ARGUMENT", `finding id is reused: ${id}`);
    seen.add(id);
    const requirementId = requireText(finding.requirement_id, "finding.requirement_id");
    if (!known.has(requirementId) || !SEVERITIES.has(String(finding.severity)))
      throw new HarnessError("INVALID_ARGUMENT", `invalid completion finding: ${id}`);
    return {
      id,
      requirement_id: requirementId,
      severity: finding.severity as CompletionFinding["severity"],
      observation: requireText(finding.observation, "finding.observation"),
      ...(Array.isArray(finding.file_paths)
        ? {
            file_paths: finding.file_paths
              .map((p) => String(p).trim())
              .filter(Boolean),
          }
        : {}),
      evidence: uniqueObjects(finding.evidence, `finding evidence for ${id}`),
      remediation: requireText(finding.remediation, "finding.remediation"),
      revalidation: requireText(finding.revalidation, "finding.revalidation"),
    };
  });
}


function evidenceItems(value: unknown, field: string): CompletionEvidenceItem[] {
  return uniqueObjects(value, field).map((raw) => {
    if (!new Set(["command", "artifact", "state"]).has(String(raw.kind)))
      throw new HarnessError("INVALID_ARGUMENT", `${field}.kind is invalid`);
    return {
      kind: raw.kind as CompletionEvidenceItem["kind"],
      reference: requireText(raw.reference, `${field}.reference`),
      observation: requireText(raw.observation, `${field}.observation`),
    };
  });
}

function requirementProofs(state: WorkflowState, value: unknown): CompletionRequirementProof[] {
  if (!Array.isArray(value))
    throw new HarnessError("INVALID_ARGUMENT", "requirement_proofs must be an array");
  const byId = new Map(state.requirements.map((requirement) => [requirement.id, requirement]));
  const seen = new Set<string>();
  const proofs = value.map((raw) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
      throw new HarnessError("INVALID_ARGUMENT", "requirement proof must be an object");
    const proof = raw as Record<string, unknown>;
    const id = requireText(proof.requirement_id, "requirement_proof.requirement_id");
    const requirement = byId.get(id);
    if (!requirement || seen.has(id))
      throw new HarnessError("INVALID_ARGUMENT", `invalid or duplicate requirement proof: ${id}`);
    seen.add(id);
    const expected: CompletionRequirementProof["status"] =
      requirementExecutionState(requirement) === "disposed" ? "out_of_scope" : "satisfied";
    if (proof.status !== expected)
      throw new HarnessError("INVALID_ARGUMENT", `requirement proof ${id} must be ${expected}`);
    return {
      requirement_id: id,
      status: expected,
      evidence: evidenceItems(proof.evidence, `proof ${id}`),
    };
  });
  if (proofs.length !== byId.size)
    throw new HarnessError("INVALID_ARGUMENT", "requirement proofs must cover every requirement");
  return proofs.sort((left, right) => left.requirement_id.localeCompare(right.requirement_id));
}

function residualRisks(value: unknown): CompletionResidualRisk[] {
  if (!Array.isArray(value))
    throw new HarnessError("INVALID_ARGUMENT", "residual_risks must be an explicit array");
  const seen = new Set<string>();
  return value.map((raw) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
      throw new HarnessError("INVALID_ARGUMENT", "residual risk must be an object");
    const risk = raw as Record<string, unknown>;
    const id = requireText(risk.id, "residual_risk.id");
    if (seen.has(id) || !SEVERITIES.has(String(risk.severity)) || risk.disposition !== "accepted")
      throw new HarnessError("INVALID_ARGUMENT", `invalid residual risk: ${id}`);
    seen.add(id);
    return {
      id,
      severity: risk.severity as CompletionResidualRisk["severity"],
      description: requireText(risk.description, "residual_risk.description"),
      disposition: "accepted",
      rationale: requireText(risk.rationale, "residual_risk.rationale"),
      evidence: uniqueObjects(risk.evidence, `residual risk evidence for ${id}`),
    };
  });
}

export function parseCompletionAssessment(state: WorkflowState, input: Record<string, unknown>) {
  const findings = findingList(state, input.findings);
  const unresolved = input.unresolved_finding_ids;
  if (!Array.isArray(unresolved) || unresolved.some((id) => typeof id !== "string"))
    throw new HarnessError("INVALID_ARGUMENT", "unresolved_finding_ids must be strings");
  const expected = findings.map(({ id }) => id).sort();
  const actual = [...new Set(unresolved as string[])].sort();
  if (
    actual.length !== (unresolved as string[]).length ||
    JSON.stringify(actual) !== JSON.stringify(expected)
  )
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "unresolved finding IDs must exactly match findings",
    );
  if ((input.status === "clean") !== (findings.length === 0))
    throw new HarnessError("INVALID_ARGUMENT", "critic status does not match findings");
  return {
    findings,
    unresolved_finding_ids: actual,
    requirement_proofs: requirementProofs(state, input.requirement_proofs),
    residual_risks: residualRisks(input.residual_risks),
  };
}
