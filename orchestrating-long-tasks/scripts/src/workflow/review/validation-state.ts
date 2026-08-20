import { applicableValidatorDomains, type ValidatorDomain } from "../../contracts/workflow.ts";
import type { TaskRecord, ValidationAttempt } from "../types.ts";

/**
 * B12.2 replaced the single `task.validation` slot with `task.validations`, one entry per domain.
 * This module is the one place that reduces the collection back to the answers callers actually
 * need — "who is validating", "has everyone passed", "archive the round" — so every consumer of the
 * old singleton (state machine, packet authority, completion gates, reporting) reads it the same way
 * instead of each re-deriving its own notion of "the" validation.
 */

export function openValidations(task: TaskRecord): ValidationAttempt[] {
  return task.validations ?? [];
}

export function validationForValidator(
  task: TaskRecord,
  validatorId: string,
): ValidationAttempt | undefined {
  return openValidations(task).find((entry) => entry.validator_id === validatorId);
}

export function validationForDomain(
  task: TaskRecord,
  domain: ValidatorDomain,
): ValidationAttempt | undefined {
  return openValidations(task).find((entry) => entry.domain === domain);
}

/**
 * The open validation started earliest — the representative entry for single-slot displays (graph
 * nodes, handoff hints) that predate multi-domain validation and show one validator per round.
 * Undefined once nothing is currently open.
 */
export function earliestOpenValidation(task: TaskRecord): ValidationAttempt | undefined {
  return openValidations(task).reduce<ValidationAttempt | undefined>(
    (earliest, entry) => (!earliest || entry.started_at < earliest.started_at ? entry : earliest),
    undefined,
  );
}

/** True once every domain the task's write scope draws (B12.2) has an open entry recording a pass. */
export function everyApplicableDomainPassed(task: TaskRecord): boolean {
  const applicable = applicableValidatorDomains(task.write_scope);
  const passed = new Set(
    openValidations(task)
      .filter((entry) => entry.verdict === "pass")
      .map((entry) => entry.domain),
  );
  return applicable.every((domain) => passed.has(domain));
}

/**
 * Moves every currently open attempt into history and clears the live collection. A reject from any
 * one domain ends the whole round for every domain — generalizing the single-validator rule this
 * replaces (B36 finding #3) — so the domains still mid-flight lose their slot along with the one
 * that rejected, and must be re-dispatched once the task is repaired and resubmitted.
 */
export function archiveOpenValidations(task: TaskRecord): void {
  const open = openValidations(task);
  if (open.length === 0) return;
  task.validation_history ??= [];
  task.validation_history.push(...open);
  delete task.validations;
}
