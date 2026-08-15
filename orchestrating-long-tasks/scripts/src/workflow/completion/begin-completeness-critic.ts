import { HarnessError } from "../../errors/harness-error.ts";
import { MAX_REPAIR_ROUNDS } from "../../config/constants.ts";
import { newLeaseToken, tokenDigest } from "../lease/token.ts";
import { requireText, utc } from "../task-state.ts";
import { systemClock, type Clock, type TransactionPort, type WorkflowState } from "../types.ts";
import { assertCriticIndependent } from "./critic-identity.ts";
import { completionReadinessIssues } from "./readiness-issues.ts";
import { completionReadinessSnapshot } from "./readiness-snapshot.ts";
import { currentRepositoryBinding, sameRepositoryBinding } from "./repository-binding.ts";

const CRITIC_DURATION_MS = 20 * 60 * 1_000;

export interface BeginCriticOptions {
  clock?: Clock;
}

export function beginCompletenessCritic(
  port: TransactionPort,
  criticId: string,
  options: BeginCriticOptions = {},
): { state: WorkflowState; token: string } {
  criticId = requireText(criticId, "critic_id");
  const now = (options.clock ?? systemClock).now();
  const token = newLeaseToken();
  const state = port.transact(criticId, "critic-assigned", {}, (draft) => {
    if (draft.completion_result?.status === "complete") {
      throw new HarnessError("INVALID_STATE", "run is already completed");
    }
    assertCriticIndependent(draft, criticId);
    const history = draft.completion_critic_history ?? [];
    const current = draft.completion_critic;
    if (history.some((entry) => entry.critic_id === criticId))
      throw new HarnessError("INVALID_STATE", "a fresh completeness critic identity is required");
    if (history.length >= MAX_REPAIR_ROUNDS)
      throw new HarnessError("INVALID_STATE", "completeness critic rounds are exhausted");
    if (current) {
      if (current.status !== "reviewed" && current.status !== "expired")
        throw new HarnessError(
          "INVALID_STATE",
          "completeness critic authorization is already active",
        );
      if (current.status === "reviewed") {
        const review = draft.completion_review;
        if (!review || review.critic_id !== current.critic_id)
          throw new HarnessError("INTEGRITY", "completion critic review history is inconsistent");
        if (
          review.status === "clean" &&
          sameRepositoryBinding(currentRepositoryBinding(draft), current.repository_binding)
        )
          throw new HarnessError(
            "INVALID_STATE",
            "the completeness critic review is already clean",
          );
        if (
          review.status === "findings" &&
          !(draft.completion_remediations ?? []).some(
            (entry) => entry.review_sha256 === review.review_sha256,
          )
        ) {
          throw new HarnessError(
            "INVALID_STATE",
            "completion findings require recorded remediation",
          );
        }
      }
    }
    const attempt = history.length + 1;
    const readinessIssues = completionReadinessIssues(draft);
    if (readinessIssues.length > 0)
      throw new HarnessError(
        "INVALID_STATE",
        `run is not ready for completeness critic: ${readinessIssues.join("; ")}`,
      );
    const readiness = completionReadinessSnapshot(draft, attempt, criticId);
    const assignment = {
      critic_id: criticId,
      token_digest: tokenDigest(token),
      attempt,
      status: "assigned",
      started_at: utc(now),
      deadline_at: utc(new Date(now.valueOf() + CRITIC_DURATION_MS)),
      readiness_sha256: readiness.sha256,
      repository_binding: currentRepositoryBinding(draft),
    } as const;
    draft.completion_critic_history ??= [];
    draft.completion_critic_history.push({ ...assignment });
    draft.completion_critic = { ...assignment };
  });
  return { state, token };
}
