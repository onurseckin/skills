import { HarnessError } from "../../errors/harness-error.ts";
import type { Finding } from "../../contracts/workflow.ts";
import { MAX_REPAIR_ROUNDS } from "../../config/constants.ts";
import { taskIn, transition, utc } from "../task-state.ts";
import { systemClock, type Clock, type TransactionPort } from "../types.ts";
import { validateReview } from "./validate-review.ts";
import { tokenMatches } from "../lease/token.ts";
import { assertValidatorCommands } from "./command-evidence.ts";
import { assertPublishedTaskPacket } from "../packet-authority.ts";

export function recordReview(
  port: TransactionPort,
  taskId: string,
  validatorId: string,
  reviewValue: unknown,
  clock: Clock = systemClock,
) {
  const now = clock.now();
  return port.transact(validatorId, "review-recorded", { task_id: taskId }, (draft) => {
    const task = taskIn(draft, taskId);
    if (task.status !== "validating" || task.validation?.validator_id !== validatorId) {
      throw new HarnessError("INVALID_STATE", "validator does not own the current validation");
    }
    const validationToken =
      typeof reviewValue === "object" && reviewValue !== null && !Array.isArray(reviewValue)
        ? (reviewValue as Record<string, unknown>).validation_token
        : undefined;
    if (!tokenMatches(validationToken, task.validation.token_digest)) {
      throw new HarnessError("INVALID_STATE", "validator authentication token is invalid");
    }
    assertPublishedTaskPacket(draft, taskId, "validator", validatorId, task.validation.attempt);
    const review = validateReview(task, reviewValue);
    assertValidatorCommands(draft, taskId, validatorId, review.checks, "review check", true);
    for (const proof of review.resolved_findings ?? []) {
      assertValidatorCommands(
        draft,
        taskId,
        validatorId,
        proof.evidence,
        `revalidation for ${proof.finding_id}`,
      );
    }
    task.validation.verdict = review.verdict;
    task.validation.reviewed_requirement_ids = review.requirement_ids;
    task.validation.checks = review.checks;
    if (review.verdict === "reject") {
      task.findings ??= [];
      task.findings.push(
        ...review.findings.map((finding) => ({ ...finding, status: "open" }) as Finding),
      );
      task.repair_round += 1;
      if (!task.original_implementer) {
        throw new HarnessError("INVALID_STATE", "task has no original implementer");
      }
      task.repair_assignee = task.original_implementer;
      const exhausted = task.repair_round >= MAX_REPAIR_ROUNDS;
      transition(
        task,
        exhausted ? "escalated" : "changes_requested",
        validatorId,
        now,
        exhausted ? "repair rounds exhausted" : "validator requested changes",
      );
      task.validation_history ??= [];
      task.validation_history.push(task.validation);
      delete task.validation;
      return;
    }
    const open = (task.findings ?? []).filter((finding) => finding.status === "open");
    const resolved = new Map(
      (review.resolved_findings ?? []).map((proof) => [proof.finding_id, proof]),
    );
    if (
      open.some((finding) => !resolved.has(finding.id)) ||
      [...resolved.keys()].some((id) => !open.some((finding) => finding.id === id))
    ) {
      throw new HarnessError("INVALID_STATE", "passing review must resolve every open finding");
    }
    for (const finding of open) {
      const proof = resolved.get(finding.id)!;
      Object.assign(finding, {
        status: "resolved",
        resolved_at: utc(now),
        resolved_by: validatorId,
        revalidation_proof: { method: proof.method, evidence: proof.evidence },
      });
    }
    transition(task, "validated", validatorId, now, "independent validation passed");
  });
}
