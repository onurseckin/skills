import { describe, expect, test } from "bun:test";
import { isRunTerminal } from "../../../olt/scripts/src/orchestrator/run-terminal.ts";
import { repositoryBinding, workflowState } from "../../workflow/shared/test-port.ts";

describe("isRunTerminal", () => {
  test("a run with no tasks at all is not terminal", () => {
    const state = workflowState();
    state.tasks = {};
    expect(isRunTerminal(state)).toBeFalse();
  });

  test("a run whose only task is still ready is not terminal", () => {
    expect(isRunTerminal(workflowState())).toBeFalse();
  });

  test.each(["done", "cancelled", "escalated"] as const)(
    "every task landing on %s makes the run terminal",
    (status) => {
      const state = workflowState();
      state.tasks["T-1"]!.status = status;
      expect(isRunTerminal(state)).toBeTrue();
    },
  );

  test("one live task among terminal ones keeps the run open", () => {
    const state = workflowState();
    state.tasks["T-1"]!.status = "done";
    state.tasks["T-2"] = { ...structuredClone(state.tasks["T-1"]!), id: "T-2", status: "running" };
    expect(isRunTerminal(state)).toBeFalse();
  });

  test("a recorded completion result is terminal on its own, regardless of task statuses", () => {
    const state = workflowState();
    state.completion_result = {
      status: "complete",
      actor: "coordinator",
      completed_at: "2026-08-19T00:00:00.000Z",
      graph_revision: 1,
      readiness_sha256: "0".repeat(64),
      repository_binding: structuredClone(repositoryBinding),
      critic_review_sha256: "0".repeat(64),
      artifact_verification_sha256: "0".repeat(64),
      mandatory_run_gate_commands: {},
    };
    expect(isRunTerminal(state)).toBeTrue();
  });
});
