import { describe, expect, test } from "bun:test";
import {
  assertReviewProtocolSatisfied,
  projectTaskReviewState,
  ReviewProtocolEngine,
} from "../../../orchestrating-long-tasks/scripts/src/policy/review-protocol.ts";
import { HarnessError } from "../../../orchestrating-long-tasks/scripts/src/errors/harness-error.ts";
import type { TaskRecord } from "../../../orchestrating-long-tasks/scripts/src/workflow/types.ts";

describe("Task Review Dual-Channel Pushback Enforcement", () => {
  const baseTask: TaskRecord = {
    id: "task-dual-01",
    status: "validating",
    requirement_ids: ["req-01"],
    write_scope: ["src/core/feature.ts"],
    dependencies: [],
    attempts: [],
    history: [],
    repair_round: 0,
    probe_round: 0,
  };

  test("assertReviewProtocolSatisfied throws INVALID_STATE when cognitive deepening is incomplete", () => {
    const task: TaskRecord = {
      ...baseTask,
      probe_round: 0, // 0/3 completed
    };

    expect(() => {
      assertReviewProtocolSatisfied(task, {
        max_adversarial_pushes: 5,
        cognitive_pushes: 3,
        escalate_on_exhausted_adversarial: true,
      });
    }).toThrow(HarnessError);

    try {
      assertReviewProtocolSatisfied(task, {
        max_adversarial_pushes: 5,
        cognitive_pushes: 3,
        escalate_on_exhausted_adversarial: true,
      });
    } catch (err) {
      const error = err as HarnessError;
      expect(error.code).toBe("INVALID_STATE");
      expect(error.message).toContain("Cognitive deepening protocol not satisfied");
      expect(error.message).toContain("Completed 0/3 required cognitive rounds");
    }
  });

  test("assertReviewProtocolSatisfied throws INVALID_STATE when 2 of 3 cognitive rounds are completed", () => {
    const task: TaskRecord = {
      ...baseTask,
      probe_round: 2, // 2/3 completed
    };

    try {
      assertReviewProtocolSatisfied(task, {
        max_adversarial_pushes: 5,
        cognitive_pushes: 3,
        escalate_on_exhausted_adversarial: true,
      });
      expect(true).toBe(false); // Should not reach here
    } catch (err) {
      const error = err as HarnessError;
      expect(error.code).toBe("INVALID_STATE");
      expect(error.message).toContain("Completed 2/3 required cognitive rounds");
    }
  });

  test("assertReviewProtocolSatisfied succeeds when all 3 cognitive rounds are completed with 0 open defects", () => {
    const task: TaskRecord = {
      ...baseTask,
      probe_round: 3, // 3/3 completed
    };

    expect(() => {
      assertReviewProtocolSatisfied(task, {
        max_adversarial_pushes: 5,
        cognitive_pushes: 3,
        escalate_on_exhausted_adversarial: true,
      });
    }).not.toThrow();
  });

  test("assertReviewProtocolSatisfied allows immediate pass when cognitive_pushes is 0", () => {
    const task: TaskRecord = {
      ...baseTask,
      probe_round: 0,
    };

    expect(() => {
      assertReviewProtocolSatisfied(task, {
        max_adversarial_pushes: 5,
        cognitive_pushes: 0,
        escalate_on_exhausted_adversarial: true,
      });
    }).not.toThrow();
  });

  test("assertReviewProtocolSatisfied throws when open defect finding exists even if cognitive rounds are completed", () => {
    const task: TaskRecord = {
      ...baseTask,
      probe_round: 3,
      findings: [
        {
          id: "f-01",
          requirement_id: "req-01",
          severity: "important",
          observation: "Unresolved logic bug",
          evidence: [],
          remediation: "Fix logic",
          revalidation: "Run test",
          status: "open",
        },
      ],
    };

    expect(() => {
      assertReviewProtocolSatisfied(task, {
        max_adversarial_pushes: 5,
        cognitive_pushes: 3,
        escalate_on_exhausted_adversarial: true,
      });
    }).toThrow("1 open finding(s) remain unresolved");
  });

  test("adversarial defect resolution followed by cognitive deepening lifecycle progression", () => {
    const engine = new ReviewProtocolEngine({
      max_adversarial_pushes: 5,
      cognitive_pushes: 3,
    });

    const task: TaskRecord = { ...baseTask };

    // Round 1: Reject with defect (Adversarial Round 1)
    task.repair_round = 1;
    task.findings = [
      {
        id: "defect-01",
        requirement_id: "req-01",
        severity: "important",
        observation: "Missing error handling",
        evidence: [],
        remediation: "Add try-catch",
        revalidation: "Run test",
        status: "open",
      },
    ];
    engine.recordEntry(task, {
      round: 1,
      channel: "adversarial",
      actor_id: "val-1",
      verdict: "reject",
      findings_count: 1,
      summary: "Missing error handling",
    });

    let state = engine.projectState(task);
    expect(state.current_phase).toBe("adversarial");
    expect(state.adversarial_rounds_used).toBe(1);
    expect(state.can_finalize_review).toBe(false);

    // Implementer fixes defect
    task.findings[0]!.status = "resolved";

    // Now transitions to cognitive deepening
    state = engine.projectState(task);
    expect(state.current_phase).toBe("cognitive");
    expect(state.can_finalize_review).toBe(false);

    // Cognitive Round 1 (Boundary Probe)
    task.probe_round = 1;
    engine.recordEntry(task, {
      round: 1,
      channel: "cognitive",
      actor_id: "val-1",
      verdict: "probe",
      probe_demands_count: 1,
      summary: "What happens when input array is empty?",
    });
    state = engine.projectState(task);
    expect(state.current_phase).toBe("cognitive");
    expect(state.cognitive_rounds_completed).toBe(1);
    expect(state.can_finalize_review).toBe(false);

    // Cognitive Round 2 (Concurrency Probe)
    task.probe_round = 2;
    engine.recordEntry(task, {
      round: 2,
      channel: "cognitive",
      actor_id: "val-1",
      verdict: "probe",
      probe_demands_count: 1,
      summary: "Are there race conditions on parallel read/writes?",
    });
    state = engine.projectState(task);
    expect(state.cognitive_rounds_completed).toBe(2);
    expect(state.can_finalize_review).toBe(false);

    // Cognitive Round 3 (Static Invariant Audit)
    task.probe_round = 3;
    engine.recordEntry(task, {
      round: 3,
      channel: "cognitive",
      actor_id: "val-1",
      verdict: "probe",
      probe_demands_count: 1,
      summary: "Prove 0 any and 0 compiler suppressions.",
    });
    state = engine.projectState(task);
    expect(state.cognitive_rounds_completed).toBe(3);
    expect(state.current_phase).toBe("completed");
    expect(state.can_finalize_review).toBe(true);

    expect(() => engine.assertSatisfied(task)).not.toThrow();
  });
});
