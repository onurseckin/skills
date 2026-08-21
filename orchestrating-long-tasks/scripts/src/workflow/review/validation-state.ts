import { applicableValidatorDomains, type ValidatorDomain } from "../../contracts/workflow.ts";
import type { TaskRecord, ValidationAttempt } from "../types.ts";

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

export function earliestOpenValidation(task: TaskRecord): ValidationAttempt | undefined {
  return openValidations(task).reduce<ValidationAttempt | undefined>(
    (earliest, entry) => (!earliest || entry.started_at < earliest.started_at ? entry : earliest),
    undefined,
  );
}

export function everyApplicableDomainPassed(task: TaskRecord): boolean {
  const applicable = applicableValidatorDomains(task.write_scope);
  const passed = new Set(
    openValidations(task)
      .filter((entry) => entry.verdict === "pass")
      .map((entry) => entry.domain),
  );
  return applicable.every((domain) => passed.has(domain));
}

export function archiveOpenValidations(task: TaskRecord): void {
  const open = openValidations(task);
  if (open.length === 0) return;
  task.validation_history ??= [];
  task.validation_history.push(...open);
  delete task.validations;
}
