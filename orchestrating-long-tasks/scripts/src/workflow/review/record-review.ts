import { HarnessError } from "../../errors/harness-error.ts";
import type { Finding } from "../../contracts/workflow.ts";
import { MAX_REPAIR_ROUNDS } from "../../config/constants.ts";
import { taskIn, transition, utc } from "../task-state.ts";
import { systemClock, type Clock, type TransactionPort } from "../types.ts";
import { validateReview } from "./validate-review.ts";
import { tokenMatches } from "../lease/token.ts";
import { assertValidatorCommands } from "./command-evidence.ts";
import { assertPublishedTaskPacket } from "../packet-authority.ts";
import { assertGatesNotFailing, assertProbeSatisfied } from "./pass-preconditions.ts";
import { readReviewShape, reviewRecordedPayload } from "./review-event.ts";
import { archiveOpenValidations, everyApplicableDomainPassed, validationForValidator } from "./validation-state.ts";

export function recordReview(
  port: TransactionPort,
  taskId: string,
  validatorId: string,
  reviewValue: unknown,
  clock: Clock = systemClock,
  maxRepairRounds: number = MAX_REPAIR_ROUNDS,
  // The probe budget lives in harness config on disk, which only the command boundary can resolve.
  // An unstated budget enforces nothing here rather than guessing what the run requires.
  minProbes = 0,
) {
  const now = clock.now();
  // The store seals the event payload before the mutation runs, so the enriched payload is built
  // from the state the caller is acting on and re-checked against the draft inside the lock.
  const payload = reviewRecordedPayload(
    taskId,
    taskIn(port.read(), taskId),
    readReviewShape(reviewValue),
  );
  return port.transact(validatorId, "review-recorded", payload, (draft) => {
    const task = taskIn(draft, taskId);
    const mine = task.status === "validating" ? validationForValidator(task, validatorId) : undefined;
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
    // A verdict is the strongest authority in the run. It is only accepted from a validator the
    // harness durably handed a validator contract to, so a token alone cannot buy one.
    assertPublishedTaskPacket(draft, taskId, "validator", validatorId, mine.attempt);
    const review = validateReview(task, reviewValue);
    const sealed = reviewRecordedPayload(taskId, task, {
      verdict: review.verdict,
      findings: review.findings,
      resolvedIds: (review.resolved_findings ?? []).map((proof) => proof.finding_id),
    });
    // Both payloads come from one builder, so a textual difference means the task moved between the
    // read and the lock and the sealed payload would misreport this verdict.
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
      // B12.2: a reject from any one domain ends the round for every domain — the others still
      // mid-flight lose their slot along with the one that rejected (see validation-state.ts).
      archiveOpenValidations(task);
      return;
    }
    assertProbeSatisfied(task, minProbes);
    assertGatesNotFailing(draft, task);
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
    // B12.2: the task passes only once every domain its write scope drew has its own pass on
    // record — the first domain to pass no longer terminates a task other domains still owe a
    // verdict on. `mine` stays in `task.validations` either way, carrying this domain's settled
    // result until the round itself is archived (a later reject) or the task finishes.
    if (everyApplicableDomainPassed(task)) {
      transition(task, "validated", validatorId, now, "independent validation passed");
    }
  });
}
