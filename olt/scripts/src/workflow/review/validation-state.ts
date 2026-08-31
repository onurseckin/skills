import { applicableValidatorDomains, type ValidatorDomain } from "../../core/contracts/index.ts";
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

export function everyApplicableDomainPassed(
  task: TaskRecord,
  requirementTexts: readonly string[] = [],
): boolean {
  const applicable = applicableValidatorDomains(task.write_scope, requirementTexts);
  if (applicable.length === 0) return false;
  const open = openValidations(task);
  const history = task.validation_history ?? [];
  const passed = new Set<ValidatorDomain>();
  for (const entry of open) {
    if (entry.verdict === "pass") passed.add(entry.domain);
  }
  for (const entry of history) {
    if (entry.verdict === "pass") passed.add(entry.domain);
  }
  return applicable.every((domain) => passed.has(domain));
}

export function archiveValidationForDomain(task: TaskRecord, domain: ValidatorDomain): void {
  if (!task.validations) return;
  const targetIndex = task.validations.findIndex((entry) => entry.domain === domain);
  if (targetIndex !== -1) {
    const [removed] = task.validations.splice(targetIndex, 1);
    if (removed) {
      task.validation_history ??= [];
      task.validation_history.push(removed);
    }
  }
  if (task.validations.length === 0) {
    delete task.validations;
  }
}

export function archiveValidationForValidator(task: TaskRecord, validatorId: string): void {
  if (!task.validations) return;
  const targetIndex = task.validations.findIndex((entry) => entry.validator_id === validatorId);
  if (targetIndex !== -1) {
    const [removed] = task.validations.splice(targetIndex, 1);
    if (removed) {
      task.validation_history ??= [];
      task.validation_history.push(removed);
    }
  }
  if (task.validations.length === 0) {
    delete task.validations;
  }
}

export function archiveOpenValidations(task: TaskRecord): void {
  const open = openValidations(task);
  if (open.length === 0) return;
  task.validation_history ??= [];
  task.validation_history.push(...open);
  delete task.validations;
}
