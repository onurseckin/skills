import { describe, expect, it } from "bun:test";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import { assertValidatorCommands } from "../../../../olt/scripts/src/workflow/review/command-evidence.ts";
import type { WorkflowState } from "../../../../olt/scripts/src/workflow/types.ts";

describe("assertValidatorCommands granular diagnostics", () => {
  const baseState: WorkflowState = {
    tasks: {
      t1: {
        id: "t1",
        status: "validating",
        requirement_ids: [],
        write_scope: ["src/app.ts"],
        dependencies: [],
        attempts: [],
        history: [],
        repair_round: 0,
        original_implementer: "impl-1",
      },
    },
    commands: {
      c_ok_stub: {
        id: "c_ok_stub",
        task_id: "t1",
        actor: "val-1",
        status: "succeeded",
        exit_code: 0,
      },
      c_failed: {
        id: "c_failed",
        task_id: "t1",
        actor: "val-1",
        status: "failed",
        exit_code: 1,
      },
      c_exit_nonzero: {
        id: "c_exit_nonzero",
        task_id: "t1",
        actor: "val-1",
        status: "succeeded",
        exit_code: 2,
      },
      c_other_task: {
        id: "c_other_task",
        task_id: "t2",
        actor: "val-1",
        status: "succeeded",
        exit_code: 0,
      },
      c_other_actor: {
        id: "c_other_actor",
        task_id: "t1",
        actor: "unknown-agent",
        status: "succeeded",
        exit_code: 0,
      },
    },
  } as unknown as WorkflowState;

  it("reports missing command with granular message", () => {
    expect(() =>
      assertValidatorCommands(
        baseState,
        "t1",
        "val-1",
        [{ command_id: "c_missing" }],
        "--evidence",
      ),
    ).toThrow("--evidence command c_missing does not exist in run state");
  });

  it("reports task mismatch with granular message", () => {
    expect(() =>
      assertValidatorCommands(
        baseState,
        "t1",
        "val-1",
        [{ command_id: "c_other_task" }],
        "--evidence",
      ),
    ).toThrow("--evidence command c_other_task belongs to task 't2', expected 't1'");
  });

  it("reports actor mismatch with granular message", () => {
    expect(() =>
      assertValidatorCommands(
        baseState,
        "t1",
        "val-1",
        [{ command_id: "c_other_actor" }],
        "--evidence",
      ),
    ).toThrow(
      "--evidence command c_other_actor actor 'unknown-agent' is neither validator 'val-1' nor implementer",
    );
  });

  it("reports status mismatch with granular message", () => {
    expect(() =>
      assertValidatorCommands(baseState, "t1", "val-1", [{ command_id: "c_failed" }], "--evidence"),
    ).toThrow("--evidence command c_failed status is 'failed', expected 'succeeded'");
  });

  it("reports exit code mismatch with granular message", () => {
    expect(() =>
      assertValidatorCommands(
        baseState,
        "t1",
        "val-1",
        [{ command_id: "c_exit_nonzero" }],
        "--evidence",
      ),
    ).toThrow("--evidence command c_exit_nonzero exited with status 2, expected 0");
  });

  it("reports embedded issues with granular message", () => {
    expect(() =>
      assertValidatorCommands(
        baseState,
        "t1",
        "val-1",
        [{ command_id: "c_ok_stub" }],
        "--evidence",
      ),
    ).toThrow("--evidence command c_ok_stub has embedded issues:");
  });
});
