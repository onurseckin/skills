import type { JsonObject } from "../../../olt/scripts/src/core/contracts/json.ts";
import { completionReviewIssues } from "../../../olt/scripts/src/workflow/completion/review-issues.ts";
import type { CompletionReview } from "../../../olt/scripts/src/workflow/completion/types.ts";
import type { WorkflowState } from "../../../olt/scripts/src/workflow/types.ts";
import { repositoryBinding, workflowState } from "./test-port.ts";

/**
 * Runs the completion gate over a review whose only interesting field is its integrity evidence,
 * so a test can assert what that one field decides without staging a whole critic lifecycle.
 */
export function integrityGateIssues(entry: JsonObject): string[] {
  const state = workflowState();
  state.requirements.length = 0;
  const review: CompletionReview = {
    critic_id: "critic",
    packet_id: "direct",
    graph_revision: 1,
    readiness_sha256: "0".repeat(64),
    repository_binding: structuredClone(repositoryBinding),
    summary: "whole diff verified against the run gate",
    status: "clean",
    unresolved_finding_ids: [],
    findings: [],
    requirement_proofs: [],
    residual_risks: [],
    integrity_evidence: [entry],
    repository_command_ids: [],
    checks: [{ command_id: "C-CHECK" }],
    reviewed_at: "2026-08-19T00:00:00.000Z",
    review_sha256: "",
  };
  return completionReviewIssues(state as WorkflowState, review);
}
