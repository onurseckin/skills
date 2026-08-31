import { MAX_REPAIR_ROUNDS } from "../../core/config/contracts.ts";
import type { Finding } from "../../core/contracts/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { tokenMatches } from "../lease/token.ts";
import { assertPublishedTaskPacket } from "../packet-authority.ts";
import { taskIn, transition, utc } from "../task-state.ts";
import { systemClock, type Clock, type TransactionPort } from "../types.ts";
import { assertValidatorCommands } from "./command-evidence.ts";
import { findingFalsifiabilityVerdict } from "./finding-falsifiability.ts";
import {
  assertGateProofFalsifiable,
  assertGatesNotFailing,
  assertProbeSatisfied,
} from "./pass-preconditions.ts";
import { readReviewShape, reviewRecordedPayload } from "./review-event.ts";
import { taskClassificationTexts } from "./role-evidence.ts";
import { validateReview } from "./validate-review.ts";
import {
  archiveValidationForValidator,
  everyApplicableDomainPassed,
  validationForValidator,
} from "./validation-state.ts";

export function recordReview(
  port: TransactionPort,
  taskId: string,
  validatorId: string,
  reviewValue: unknown,
  clock: Clock = systemClock,
  maxRepairRounds: number = MAX_REPAIR_ROUNDS,
  minProbes = 0,
) {
  const now = clock.now();
  const payload = reviewRecordedPayload(
    taskId,
    taskIn(port.read(), taskId),
    readReviewShape(reviewValue),
  );
  return port.transact(validatorId, "review-recorded", payload, (draft) => {
    const task = taskIn(draft, taskId);
    const mine =
      task.status === "validating" ? validationForValidator(task, validatorId) : undefined;
    if (!mine) {
      throw new HarnessError("INVALID_STATE", "validator does not own the current validation");
    }
    const validationToken =
      typeof reviewValue === "object" && reviewValue !== null && !Array.isArray(reviewValue)
        ? (reviewValue as Record<string, unknown>).validation_token
        : undefined;
    if (!tokenMatches(validationToken, mine.token_digest)) {
      throw new HarnessError("INVALID_STATE", "validator authentication token is invalid");
    }
    assertPublishedTaskPacket(draft, taskId, "validator", validatorId, mine.attempt);
    const review = validateReview(task, reviewValue);
    const sealed = reviewRecordedPayload(taskId, task, {
      verdict: review.verdict,
      findings: review.findings,
      resolvedIds: (review.resolved_findings ?? []).map((proof) => proof.finding_id),
    });
    if (JSON.stringify(sealed) !== JSON.stringify(payload)) {
      throw new HarnessError("INVALID_STATE", "the review changed while it was being recorded");
    }
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
    mine.verdict = review.verdict;
    mine.reviewed_requirement_ids = review.requirement_ids;
    mine.checks = review.checks;
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
      const exhausted = task.repair_round >= maxRepairRounds;
      transition(
        task,
        exhausted ? "escalated" : "changes_requested",
        validatorId,
        now,
        exhausted ? "repair rounds exhausted" : "validator requested changes",
      );
      archiveValidationForValidator(task, validatorId);
      return;
    }
    assertProbeSatisfied(task, minProbes);
    assertGatesNotFailing(draft, task);
    assertGateProofFalsifiable(draft, task);
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
    const falsifiability = findingFalsifiabilityVerdict(draft, task);
    for (const finding of open) {
      const proof = resolved.get(finding.id)!;
      Object.assign(finding, {
        status: "resolved",
        resolved_at: utc(now),
        resolved_by: validatorId,
        revalidation_proof: { method: proof.method, evidence: proof.evidence },
        falsifiability,
      });
    }
    if (everyApplicableDomainPassed(task, taskClassificationTexts(draft, task))) {
      transition(task, "validated", validatorId, now, "independent validation passed");
    }
  });
}
