import { describe, expect, test } from "bun:test";
import {
  archiveOpenValidations,
  earliestOpenValidation,
  everyApplicableDomainPassed,
  openValidations,
  validationForDomain,
  validationForValidator,
} from "../../../olt/scripts/src/workflow/review/validation-state.ts";
import type { TaskRecord, ValidationAttempt } from "../../../olt/scripts/src/workflow/types.ts";

function attempt(overrides: Partial<ValidationAttempt> = {}): ValidationAttempt {
  return {
    validator_id: "v",
    domain: "code-quality",
    token_digest: "d",
    attempt: 1,
    started_at: "2026-08-13T12:00:00.000Z",
    deadline_at: "2026-08-13T13:00:00.000Z",
    ...overrides,
  };
}

function task(validations?: ValidationAttempt[]): TaskRecord {
  return {
    id: "T-1",
    status: "validating",
    requirement_ids: [],
    write_scope: [],
    dependencies: [],
    attempts: [],
    history: [],
    repair_round: 0,
    ...(validations === undefined ? {} : { validations }),
  };
}

describe("earliestOpenValidation", () => {
  test("returns undefined when there are no open validations", () => {
    expect(earliestOpenValidation(task())).toBeUndefined();
    expect(earliestOpenValidation(task([]))).toBeUndefined();
  });

  test("returns the sole validation when there is only one", () => {
    const only = attempt({ validator_id: "solo" });
    expect(earliestOpenValidation(task([only]))).toBe(only);
  });

  test("returns the validation with the earliest started_at among several", () => {
    const later = attempt({ validator_id: "later", started_at: "2026-08-13T14:00:00.000Z" });
    const earliest = attempt({ validator_id: "earliest", started_at: "2026-08-13T10:00:00.000Z" });
    const middle = attempt({ validator_id: "middle", started_at: "2026-08-13T12:00:00.000Z" });
    expect(earliestOpenValidation(task([later, earliest, middle]))).toBe(earliest);
  });
});

describe("validation-state helpers", () => {
  test("openValidations returns array of validations or empty array", () => {
    expect(openValidations(task())).toEqual([]);
    const a1 = attempt({ validator_id: "v1" });
    expect(openValidations(task([a1]))).toEqual([a1]);
  });

  test("validationForValidator finds validation matching validator id", () => {
    const a1 = attempt({ validator_id: "val-1" });
    const t = task([a1]);
    expect(validationForValidator(t, "val-1")).toBe(a1);
    expect(validationForValidator(t, "val-2")).toBeUndefined();
  });

  test("validationForDomain finds validation matching domain", () => {
    const a1 = attempt({ domain: "code-quality" });
    const t = task([a1]);
    expect(validationForDomain(t, "code-quality")).toBe(a1);
    expect(validationForDomain(t, "security")).toBeUndefined();
  });

  test("everyApplicableDomainPassed checks open and historical passes across applicable domains", () => {
    // Empty applicable domains -> returns false
    const emptyTask = task();
    expect(everyApplicableDomainPassed(emptyTask)).toBe(false);

    // Task with write scope ["src/app"] -> draws code-quality
    const codeTask = {
      ...task(),
      write_scope: ["src/app/main.ts"],
    };

    // No validations -> false
    expect(everyApplicableDomainPassed(codeTask)).toBe(false);

    // Open validation passed
    const openPassedTask = {
      ...codeTask,
      validations: [attempt({ domain: "code-quality", verdict: "pass" })],
    };
    expect(everyApplicableDomainPassed(openPassedTask)).toBe(true);

    // Historical validation passed when open is empty
    const historyPassedTask = {
      ...codeTask,
      validation_history: [attempt({ domain: "code-quality", verdict: "pass" })],
    };
    expect(everyApplicableDomainPassed(historyPassedTask)).toBe(true);
  });

  test("archiveOpenValidations moves open validations to validation_history and deletes task.validations", () => {
    const t = task();
    // Empty validations -> no-op
    archiveOpenValidations(t);
    expect(t.validations).toBeUndefined();

    const a1 = attempt({ validator_id: "v1" });
    t.validations = [a1];
    archiveOpenValidations(t);
    expect(t.validations).toBeUndefined();
    expect(t.validation_history).toEqual([a1]);

    // Archiving again appends to existing history
    const a2 = attempt({ validator_id: "v2" });
    t.validations = [a2];
    archiveOpenValidations(t);
    expect(t.validation_history).toEqual([a1, a2]);
  });
});
