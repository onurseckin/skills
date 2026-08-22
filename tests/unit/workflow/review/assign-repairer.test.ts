import { describe, expect, test } from "bun:test";
import { assignReplacementRepairer } from "../../../../orchestrating-long-tasks/scripts/src/workflow/review/assign-repairer.ts";
import { TestPort, workflowState } from "../test-port.ts";

function portWithChangesRequestedTask(overrides: Record<string, unknown> = {}): TestPort {
  const state = workflowState();
  Object.assign(state.tasks["T-1"]!, {
    status: "changes_requested",
    original_implementer: "agent-original",
    repair_round: 0,
    attempts: [],
    ...overrides,
  });
  return new TestPort(state);
}

describe("assignReplacementRepairer", () => {
  test("rejects assigning a replacement when the task is not awaiting its original repairer", () => {
    const port = portWithChangesRequestedTask({ status: "running" });
    expect(() =>
      assignReplacementRepairer(port, "T-1", "agent-new", "coordinator", "stale", "no response"),
    ).toThrow(/task is not awaiting its original repairer/);
  });

  test("rejects assigning a replacement when the task has no original_implementer on record", () => {
    const port = portWithChangesRequestedTask({ original_implementer: undefined });
    expect(() =>
      assignReplacementRepairer(port, "T-1", "agent-new", "coordinator", "stale", "no response"),
    ).toThrow(/task is not awaiting its original repairer/);
  });

  test("rejects a replacement id equal to the original implementer", () => {
    const port = portWithChangesRequestedTask();
    expect(() =>
      assignReplacementRepairer(
        port,
        "T-1",
        "agent-original",
        "coordinator",
        "stale",
        "no response",
      ),
    ).toThrow(/replacement must differ from original implementer/);
  });

  test("rejects a repeated_failure reason before the original implementer has actually failed twice", () => {
    const port = portWithChangesRequestedTask({ repair_round: 1 });
    expect(() =>
      assignReplacementRepairer(
        port,
        "T-1",
        "agent-new",
        "coordinator",
        "repeated_failure",
        "two failed attempts",
      ),
    ).toThrow(/original implementer has not failed repeatedly/);
  });

  test("accepts repeated_failure once repair_round has reached 2", () => {
    const port = portWithChangesRequestedTask({ repair_round: 2 });
    const state = assignReplacementRepairer(
      port,
      "T-1",
      "agent-new",
      "coordinator",
      "repeated_failure",
      "two failed attempts",
    );
    expect(state.tasks["T-1"]!.repair_assignee).toBe("agent-new");
    expect(state.tasks["T-1"]!.replacement_reason).toBe("repeated_failure");
  });

  test("rejects a stale reason when the last attempt is not itself a stale repair", () => {
    const port = portWithChangesRequestedTask({ attempts: [{ kind: "repair", result: "ok" }] });
    expect(() =>
      assignReplacementRepairer(port, "T-1", "agent-new", "coordinator", "stale", "lease expired"),
    ).toThrow(/original repair lease is not stale/);
  });

  test("rejects a stale reason when there are no attempts at all", () => {
    const port = portWithChangesRequestedTask({ attempts: [] });
    expect(() =>
      assignReplacementRepairer(port, "T-1", "agent-new", "coordinator", "stale", "lease expired"),
    ).toThrow(/original repair lease is not stale/);
  });

  test("accepts a stale reason once the last attempt is a stale repair", () => {
    const port = portWithChangesRequestedTask({ attempts: [{ kind: "repair", result: "stale" }] });
    const state = assignReplacementRepairer(
      port,
      "T-1",
      "agent-new",
      "coordinator",
      "stale",
      "lease expired",
    );
    expect(state.tasks["T-1"]!.repair_assignee).toBe("agent-new");
    expect(state.tasks["T-1"]!.replacement_evidence).toBe("lease expired");
  });

  test("accepts an unavailable reason without needing repair_round or attempt evidence", () => {
    const port = portWithChangesRequestedTask({ repair_round: 0, attempts: [] });
    const state = assignReplacementRepairer(
      port,
      "T-1",
      "agent-new",
      "coordinator",
      "unavailable",
      "agent left",
    );
    expect(state.tasks["T-1"]!.replacement_reason).toBe("unavailable");
  });

  test("rejects assigning a validator of the task as the replacement repairer (anti-boundary-leak rule)", () => {
    const port = portWithChangesRequestedTask({
      validations: [{ validator_id: "val-1", attempt: 1, verdict: "reject" }],
    });
    expect(() =>
      assignReplacementRepairer(
        port,
        "T-1",
        "val-1",
        "coordinator",
        "unavailable",
        "reassign to validator",
      ),
    ).toThrow(/cannot be a validator of task 'T-1' \(anti-boundary-leak rule\)/);
  });
});
