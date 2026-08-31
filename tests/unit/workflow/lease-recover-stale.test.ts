import { describe, expect, test } from "bun:test";
import { recoverStale } from "../../../olt/scripts/src/workflow/lease/recover-stale.ts";
import { at, TestPort, workflowState } from "./test-port.ts";

const started = at("2026-08-13T12:00:00.000Z");

function validation(overrides: Record<string, unknown> = {}) {
  return {
    validator_id: "validator-1",
    domain: "code-quality",
    token_digest: "digest",
    attempt: 1,
    started_at: "2026-08-13T12:00:00.000Z",
    deadline_at: "2026-08-13T12:00:05.000Z",
    ...overrides,
  };
}

describe("recoverStale grace_seconds validation", () => {
  test("rejects a negative grace period", () => {
    const port = new TestPort(workflowState());
    expect(() => recoverStale(port, "coordinator", started, { graceSeconds: -1 })).toThrow(
      /grace_seconds must be an integer from 0 to 86400/,
    );
  });

  test("rejects a grace period beyond one day", () => {
    const port = new TestPort(workflowState());
    expect(() => recoverStale(port, "coordinator", started, { graceSeconds: 86_401 })).toThrow(
      /grace_seconds must be an integer from 0 to 86400/,
    );
  });

  test("rejects a non-integer grace period", () => {
    const port = new TestPort(workflowState());
    expect(() => recoverStale(port, "coordinator", started, { graceSeconds: 1.5 })).toThrow(
      /grace_seconds must be an integer from 0 to 86400/,
    );
  });
});

describe("recoverStale abandoned validations on a validating task", () => {
  function validatingPort(validations: ReturnType<typeof validation>[]): TestPort {
    const state = workflowState();
    Object.assign(state.tasks["T-1"]!, { status: "validating", validations });
    return new TestPort(state);
  }

  test("leaves validations untouched while every entry is still within its deadline", () => {
    const port = validatingPort([
      validation({ validator_id: "still-open", deadline_at: "2026-08-13T12:10:00.000Z" }),
    ]);
    const result = recoverStale(port, "coordinator", at("2026-08-13T12:00:01.000Z"), {
      graceSeconds: 0,
    });
    const task = result.tasks["T-1"]!;
    expect(task.status).toBe("validating");
    expect(task.validations).toHaveLength(1);
  });

  test("drops only the validator whose deadline has passed with no verdict, keeping the rest open", () => {
    const port = validatingPort([
      validation({ validator_id: "stale", deadline_at: "2026-08-13T12:00:05.000Z" }),
      validation({ validator_id: "fresh", deadline_at: "2026-08-13T13:00:00.000Z" }),
    ]);
    const result = recoverStale(port, "coordinator", at("2026-08-13T12:00:36.000Z"), {
      graceSeconds: 0,
    });
    const task = result.tasks["T-1"]!;
    expect(task.status).toBe("validating");
    expect(task.validations?.map((entry) => entry.validator_id)).toEqual(["fresh"]);
  });

  test("keeps a settled verdict even long after its deadline has passed", () => {
    const port = validatingPort([
      validation({
        validator_id: "settled",
        verdict: "reject",
        deadline_at: "2026-08-13T12:00:05.000Z",
      }),
    ]);
    const result = recoverStale(port, "coordinator", at("2026-08-13T13:00:00.000Z"), {
      graceSeconds: 0,
    });
    const task = result.tasks["T-1"]!;
    expect(task.status).toBe("validating");
    expect(task.validations).toHaveLength(1);
  });

  test("returns the task to submitted and clears validations once every validator has abandoned", () => {
    const port = validatingPort([
      validation({ validator_id: "stale-one", deadline_at: "2026-08-13T12:00:05.000Z" }),
      validation({ validator_id: "stale-two", deadline_at: "2026-08-13T12:00:05.000Z" }),
    ]);
    const result = recoverStale(port, "coordinator", at("2026-08-13T12:00:36.000Z"), {
      graceSeconds: 0,
    });
    const task = result.tasks["T-1"]!;
    expect(task.status).toBe("submitted");
    expect(task.validations).toBeUndefined();
    expect(task.history.at(-1)).toMatchObject({
      from: "validating",
      to: "submitted",
      reason: "validation interrupted",
    });
  });
});
