import { describe, expect, it } from "bun:test";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import { beginValidation } from "../../../../olt/scripts/src/workflow/review/begin-validation.ts";
import type {
  TaskRecord,
  TransactionPort,
  WorkflowState,
} from "../../../../olt/scripts/src/workflow/types.ts";

describe("beginValidation independence and rotation separation", () => {
  function makePort(task: TaskRecord): TransactionPort {
    const state: WorkflowState = {
      tasks: { [task.id]: task },
      commands: {},
    } as unknown as WorkflowState;

    return {
      read: () => state,
      transact: (_actor, _kind, _payload, mutate) => {
        mutate(state);
        return state;
      },
    } as unknown as TransactionPort;
  }

  it("throws implementer error if validator was original implementer", () => {
    const task: TaskRecord = {
      id: "t1",
      status: "submitted",
      requirement_ids: [],
      write_scope: ["src/app.ts"],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 0,
      original_implementer: "val-1",
    };
    const port = makePort(task);
    expect(() => beginValidation(port, "t1", "val-1")).toThrow(
      "validator must be independent from implementers",
    );
  });

  it("throws active validation error if validator already has open validation", () => {
    const task: TaskRecord = {
      id: "t1",
      status: "validating",
      requirement_ids: [],
      write_scope: ["src/app.ts"],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 0,
      original_implementer: "impl-1",
      validations: [
        {
          validator_id: "val-1",
          domain: "code",
          token_digest: "digest",
          attempt: 1,
          started_at: "2026-01-01T00:00:00Z",
          deadline_at: "2026-01-01T01:00:00Z",
        },
      ],
    };
    const port = makePort(task);
    expect(() => beginValidation(port, "t1", "val-1")).toThrow(
      "validator 'val-1' already has an active validation for t1",
    );
  });

  it("throws rotation error if validator was previous validator and not a resubmission", () => {
    const task: TaskRecord = {
      id: "t1",
      status: "submitted",
      requirement_ids: [],
      write_scope: ["src/app.ts"],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 0,
      original_implementer: "impl-1",
      validation_history: [
        {
          validator_id: "val-1",
          domain: "code",
          token_digest: "digest",
          attempt: 1,
          started_at: "2026-01-01T00:00:00Z",
          deadline_at: "2026-01-01T01:00:00Z",
        },
      ],
    };
    const port = makePort(task);
    expect(() => beginValidation(port, "t1", "val-1")).toThrow(
      "validator 'val-1' has already reviewed this task; a distinct validator is required for rotation",
    );
  });

  it("permits same validator in a resubmission workflow (repair_round > 0)", () => {
    const task: TaskRecord = {
      id: "t1",
      status: "submitted",
      requirement_ids: [],
      write_scope: ["src/app.ts"],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 1,
      original_implementer: "impl-1",
      validation_history: [
        {
          validator_id: "val-1",
          domain: "code",
          token_digest: "digest",
          attempt: 1,
          started_at: "2026-01-01T00:00:00Z",
          deadline_at: "2026-01-01T01:00:00Z",
          verdict: "reject",
        },
      ],
    };
    const port = makePort(task);
    expect(() => beginValidation(port, "t1", "val-1")).not.toThrow();
  });
});
