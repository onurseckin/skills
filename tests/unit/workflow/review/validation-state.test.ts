import { describe, expect, test } from "bun:test";
import { earliestOpenValidation } from "../../../../orchestrating-long-tasks/scripts/src/workflow/review/validation-state.ts";
import type {
  TaskRecord,
  ValidationAttempt,
} from "../../../../orchestrating-long-tasks/scripts/src/workflow/types.ts";

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
