import { requirementExecutionState } from "../authority/index.ts";
import type { CompletionReview, WorkflowState } from "../types.ts";
import { completionReviewDigest, jsonDigest } from "./completion-review-digest.ts";
import { completionReadinessSnapshot } from "./readiness-snapshot.ts";
import { authoritativeRepositoryCommand } from "./repository-evidence.ts";
import { sameRepositoryBinding } from "./repository-binding.ts";

function assessmentIssues(state: WorkflowState, review: CompletionReview): string[] {
  const issues: string[] = [];
  const findingIds = review.findings.map(({ id }) => id).sort();
  if (JSON.stringify(findingIds) !== JSON.stringify([...review.unresolved_finding_ids].sort()))
    issues.push("completion finding IDs are inconsistent");
  const proofs = new Map(review.requirement_proofs.map((proof) => [proof.requirement_id, proof]));
  if (proofs.size !== state.requirements.length)
    issues.push("completion requirement proof coverage is incomplete");
  for (const requirement of state.requirements) {
    const proof = proofs.get(requirement.id);
    const expected =
      requirementExecutionState(requirement) === "disposed" ? "out_of_scope" : "satisfied";
    if (!proof || proof.status !== expected || proof.evidence.length === 0)
      issues.push(`completion requirement proof is invalid: ${requirement.id}`);
    for (const evidence of proof?.evidence ?? [])
      if (evidence.kind === "command") {
        const command = authoritativeRepositoryCommand(state, evidence.reference);
        if (!command || command.actor !== review.critic_id)
          issues.push(`completion requirement proof command is invalid: ${evidence.reference}`);
      }
  }
  if (
    review.residual_risks.some((risk) => !risk.evidence.length || risk.disposition !== "accepted")
  )
    issues.push("completion residual risk evidence is invalid");
  return issues;
}

function provenanceIssues(state: WorkflowState, review: CompletionReview): string[] {
  const packet = state.packets?.[review.packet_id];
  const assignment = state.completion_critic;
  const issues: string[] = [];
  if (
    !packet ||
    packet.status !== "published" ||
    packet.role !== "completeness-critic" ||
    packet.agent_id !== review.critic_id ||
    packet.task_id !== null ||
    packet.packet_sha256 !== review.packet_sha256 ||
    packet.readiness_sha256 !== review.readiness_sha256 ||
    !sameRepositoryBinding(packet.repository_binding, review.repository_binding) ||
    packet.graph_revision !== review.graph_revision ||
    state.graph_revision !== review.graph_revision ||
    packet.integrity_evidence_sha256 !== jsonDigest(review.integrity_evidence) ||
    JSON.stringify(packet.repository_command_ids) !==
      JSON.stringify(review.repository_command_ids) ||
    review.review_sha256 !== completionReviewDigest(review)
  )
    issues.push("completion review packet provenance is invalid");
  if (
    !assignment ||
    assignment.critic_id !== review.critic_id ||
    assignment.status !== "reviewed" ||
    assignment.packet_id !== review.packet_id
  )
    issues.push("completion critic authorization provenance is invalid");
  else if (
    assignment.readiness_sha256 !== review.readiness_sha256 ||
    !sameRepositoryBinding(assignment.repository_binding, review.repository_binding) ||
    !sameRepositoryBinding(state.current_repository_binding, review.repository_binding) ||
    completionReadinessSnapshot(state, assignment.attempt, assignment.critic_id).sha256 !==
      review.readiness_sha256
  )
    issues.push("completion readiness snapshot is stale");
  return issues;
}

export function completionReviewIssues(
  state: WorkflowState,
  review: CompletionReview | undefined,
): string[] {
  if (!review) return ["authoritative completion review is missing"];
  const issues = [...provenanceIssues(state, review), ...assessmentIssues(state, review)];
  if (review.status !== "clean") issues.push("completeness critic is not clean");
  for (const id of review.unresolved_finding_ids)
    issues.push(`completeness critic has unresolved finding ${id}`);
  if (
    review.integrity_evidence.length === 0 ||
    review.integrity_evidence.some(
      (entry) =>
        entry.status !== "passed" || (Array.isArray(entry.issues) && entry.issues.length > 0),
    )
  )
    issues.push("completion integrity evidence is not clean");
  for (const id of review.repository_command_ids)
    if (!authoritativeRepositoryCommand(state, id))
      issues.push(`completion repository command is invalid: ${id}`);
  if (review.checks.length === 0) issues.push("completion critic checks are missing");
  for (const { command_id: id } of review.checks) {
    const command = authoritativeRepositoryCommand(state, id);
    if (!command || command.actor !== review.critic_id)
      issues.push(`completion critic check is invalid: ${id}`);
  }
  return issues;
}
