import type { CompletionReview, WorkflowState } from "../types.ts";
import { completionReviewDigest, jsonDigest } from "./completion-review-digest.ts";
import { authoritativeRepositoryCommand } from "./repository-evidence.ts";
import { repositoryBindingIsValid, sameRepositoryBinding } from "./repository-binding.ts";

function reviewRemediationIssues(state: WorkflowState, review: CompletionReview, index: number) {
  const issues: string[] = [];
  if (review.review_sha256 !== completionReviewDigest(review))
    issues.push(`completion review history ${index + 1} has an invalid digest`);
  const expectedFindings = review.findings.map(({ id }) => id).sort();
  if (
    JSON.stringify(expectedFindings) !== JSON.stringify([...review.unresolved_finding_ids].sort())
  )
    issues.push(`completion review history ${index + 1} finding IDs are inconsistent`);
  if (review.status !== "findings") return issues;
  const remediation = (state.completion_remediations ?? []).find(
    (entry) => entry.review_sha256 === review.review_sha256,
  );
  const actual = remediation?.resolutions.map(({ finding_id }) => finding_id).sort() ?? [];
  if (!remediation || JSON.stringify(actual) !== JSON.stringify(expectedFindings))
    issues.push(`completion findings review ${index + 1} lacks exact remediation`);
  if (!(state.completion_reviews ?? [])[index + 1])
    issues.push(`completion findings review ${index + 1} lacks re-review`);
  if (!remediation) return issues;
  const { remediation_sha256: digest, ...base } = remediation;
  if (digest !== jsonDigest(base))
    issues.push(`completion remediation ${index + 1} has an invalid digest`);
  for (const resolution of remediation.resolutions)
    for (const id of resolution.command_ids)
      if (!authoritativeRepositoryCommand(state, id))
        issues.push(`completion remediation command is invalid: ${id}`);
  return issues;
}

export function completionHistoryIssues(state: WorkflowState): string[] {
  const reviews = state.completion_reviews ?? [];
  const critics = state.completion_critic_history ?? [];
  const remediations = state.completion_remediations ?? [];
  if (
    reviews.length === 0 ||
    reviews.at(-1)?.review_sha256 !== state.completion_review?.review_sha256
  )
    return ["completion review history is missing or stale"];
  const issues: string[] = [];
  if (new Set(critics.map(({ critic_id }) => critic_id)).size !== critics.length)
    issues.push("completion critic history reuses an identity");
  if (new Set(remediations.map(({ review_sha256 }) => review_sha256)).size !== remediations.length)
    issues.push("completion remediation history contains duplicate reviews");
  if (critics.filter(({ status }) => status === "reviewed").length !== reviews.length)
    issues.push("completion reviewed critic history does not match review history");
  for (let index = 0; index < critics.length; index += 1) {
    const critic = critics[index]!;
    if (critic.attempt !== index + 1)
      issues.push(`completion critic authorization ${index + 1} has invalid attempt order`);
    if (
      !Number.isFinite(Date.parse(critic.deadline_at)) ||
      !/^[0-9a-f]{64}$/u.test(critic.readiness_sha256) ||
      !repositoryBindingIsValid(critic.repository_binding)
    )
      issues.push(`completion critic authorization ${index + 1} is incomplete`);
    if (critic.status === "expired") continue;
    const review = reviews.find(
      (entry) => entry.critic_id === critic.critic_id && entry.packet_id === critic.packet_id,
    );
    if (critic.status !== "reviewed" || !review)
      issues.push(`completion critic authorization ${index + 1} is inconsistent`);
  }
  reviews.forEach((review, index) => {
    const critic = critics.find(
      (entry) => entry.critic_id === review.critic_id && entry.packet_id === review.packet_id,
    );
    if (
      !critic ||
      critic.status !== "reviewed" ||
      critic.readiness_sha256 !== review.readiness_sha256 ||
      !sameRepositoryBinding(critic.repository_binding, review.repository_binding)
    )
      issues.push(`completion review authorization ${index + 1} is inconsistent`);
    issues.push(...reviewRemediationIssues(state, review, index));
  });
  return issues;
}
