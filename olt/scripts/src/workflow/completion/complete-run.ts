import { HarnessError } from "../../errors/harness-error.ts";
import { tokenMatches } from "../lease/token.ts";
import { requireText, utc } from "../task-state.ts";
import { systemClock, type Clock, type TransactionPort } from "../types.ts";
import {
  completionArtifactRequirements,
  validateCompletionArtifactVerification,
  type CompletionArtifactRequirements,
} from "./artifact-verification.ts";
import { completionIssues, mandatoryRunGateCommands } from "./completion-state.ts";
import type { WorkflowState } from "../types.ts";

export type CompletionArtifactVerifier = (
  state: Readonly<WorkflowState>,
  requirements: CompletionArtifactRequirements,
) => unknown;

export function completeRun(
  port: TransactionPort,
  actor: string,
  verifyArtifacts: CompletionArtifactVerifier,
  authToken: string,
  clock: Clock = systemClock,
) {
  actor = requireText(actor, "actor");
  authToken = requireText(authToken, "auth_token");
  const current = port.read();
  if (current.completion_result?.status === "complete") return current;
  const now = clock.now();
  return port.transact(actor, "run-completed", {}, (draft) => {
    const preflight = completionIssues(draft).filter(
      (issue) => issue !== "completion artifact verification is missing",
    );
    if (preflight.length > 0)
      throw new HarnessError("INVALID_STATE", `run is incomplete: ${preflight.join("; ")}`);
    const assignment = draft.completion_critic!;
    if (!tokenMatches(authToken, assignment.token_digest))
      throw new HarnessError("INVALID_STATE", "completion authorization token is invalid");
    const requirements = completionArtifactRequirements(draft);
    const verification = validateCompletionArtifactVerification(
      draft,
      verifyArtifacts(draft, requirements),
    );
    const issues = completionIssues(draft, verification);
    if (issues.length > 0)
      throw new HarnessError("INVALID_STATE", `run is incomplete: ${issues.join("; ")}`);
    const review = draft.completion_review!;
    draft.completion_verification = verification;
    draft.completion_result = {
      status: "complete",
      actor,
      completed_at: utc(now),
      graph_revision: review.graph_revision,
      readiness_sha256: review.readiness_sha256,
      repository_binding: structuredClone(review.repository_binding),
      critic_review_sha256: review.review_sha256,
      artifact_verification_sha256: verification.verification_sha256,
      mandatory_run_gate_commands: mandatoryRunGateCommands(draft),
    };
  });
}
