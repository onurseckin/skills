import { describe, expect, test } from "bun:test";
import {
  evaluateHierarchicalDecision,
  assertHierarchicalCompliance,
} from "../../../olt/scripts/src/engine/scheduler/conflict/decision-tree.ts";
import type { TaskRecord, WorkflowState } from "../../../olt/scripts/src/workflow/types.ts";

describe("Hierarchical Decision Tree & Dominating Skill Mechanics", () => {
  const dummyState: WorkflowState = {
    tasks: {
      "task-1": {
        id: "task-1",
        status: "ready",
        requirement_ids: ["req-1"],
        write_scope: ["src/feature.ts"],
        dependencies: [],
        attempts: [],
        history: [],
        repair_round: 0,
        original_implementer: "agent-worker-1",
      } as unknown as TaskRecord,
      "task-repair": {
        id: "task-repair",
        status: "changes_requested",
        requirement_ids: ["req-2"],
        write_scope: ["src/repair.ts"],
        dependencies: [],
        attempts: [],
        history: [],
        repair_round: 1,
        original_implementer: "agent-worker-1",
        repair_assignee: "agent-worker-1",
      } as unknown as TaskRecord,
    },
    requirements: [],
    gates: [],
    commands: {},
    orphan_evidence: [],
  };

  test("Rule D1: Prohibits Coordinators from writing code directly", () => {
    const outcome = evaluateHierarchicalDecision(
      { actor: "coord-1", role: "coordinator" },
      "write_code",
    );
    expect(outcome.allowed).toBeFalse();
    expect(outcome.ruleId).toBe("DOM-01-COORDINATOR-NO-CODE");
    expect(() =>
      assertHierarchicalCompliance({ actor: "coord-1", role: "coordinator" }, "write_code"),
    ).toThrow("Hierarchical decision tree violation [DOM-01-COORDINATOR-NO-CODE]");
  });

  test("Rule D2: Allows the implementer role to claim a fresh ready task", () => {
    const outcome = evaluateHierarchicalDecision(
      { actor: "worker-1", role: "implementer", targetTaskId: "task-1", state: dummyState },
      "claim_task",
    );
    expect(outcome.allowed).toBeTrue();
    expect(outcome.ruleId).toBe("DOM-00-PERMITTED");
  });

  test("Rule D3: Allows the same implementer role to claim a changes_requested task for in-lease repair, since repair is no longer gated by a separate repairer role", () => {
    const outcome = evaluateHierarchicalDecision(
      { actor: "worker-1", role: "implementer", targetTaskId: "task-repair", state: dummyState },
      "claim_task",
    );
    expect(outcome.allowed).toBeTrue();
    expect(outcome.ruleId).toBe("DOM-00-PERMITTED");
  });

  test("Rule D4: Prohibits Validators from reviewing their own code", () => {
    const outcome = evaluateHierarchicalDecision(
      { actor: "agent-worker-1", role: "validator", targetTaskId: "task-1", state: dummyState },
      "record_review",
    );
    expect(outcome.allowed).toBeFalse();
    expect(outcome.ruleId).toBe("DOM-04-VALIDATOR-INDEPENDENCE");
  });

  test("Rule D5: Prohibits Completeness Critic from reviewing while tasks are still in changes_requested, permits when all tasks done", () => {
    const outcome = evaluateHierarchicalDecision(
      { actor: "critic-1", role: "completeness-critic", state: dummyState },
      "critic_start",
    );
    expect(outcome.allowed).toBeFalse();
    expect(outcome.ruleId).toBe("DOM-05-CRITIC-PREMATURE-START");

    const allDoneState: WorkflowState = {
      ...dummyState,
      tasks: {
        "task-1": { ...dummyState.tasks["task-1"]!, status: "done" } as TaskRecord,
        "task-repair": { ...dummyState.tasks["task-repair"]!, status: "validated" } as TaskRecord,
      },
    };
    const readyCriticOutcome = evaluateHierarchicalDecision(
      { actor: "critic-1", role: "completeness-critic", state: allDoneState },
      "critic_review",
    );
    expect(readyCriticOutcome.allowed).toBeTrue();
  });

  test("Rule D6: Prohibits Implementers from recording validation reviews", () => {
    const outcome = evaluateHierarchicalDecision(
      { actor: "worker-1", role: "implementer" },
      "record_review",
    );
    expect(outcome.allowed).toBeFalse();
    expect(outcome.ruleId).toBe("DOM-06-WORKER-NO-SELF-REVIEW");
  });

  test("Allows standard role-permitted actions", () => {
    const implementerClaim = evaluateHierarchicalDecision(
      { actor: "worker-1", role: "implementer", targetTaskId: "task-1", state: dummyState },
      "claim_task",
    );
    expect(implementerClaim.allowed).toBeTrue();

    const validatorStart = evaluateHierarchicalDecision(
      { actor: "independent-val", role: "validator", targetTaskId: "task-1", state: dummyState },
      "validate_start",
    );
    expect(validatorStart.allowed).toBeTrue();
  });
});
