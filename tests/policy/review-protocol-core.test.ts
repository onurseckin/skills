import { describe, expect, test } from "bun:test";
import {
  canFinalizeReview,
  DEFAULT_REVIEW_PROTOCOL_CONFIG,
  evaluateReviewPhase,
  projectTaskReviewState,
  ReviewProtocolEngine,
  type ReviewChannelEntry,
} from "../../olt/scripts/src/policy/index.ts";
import type { TaskRecord } from "../../olt/scripts/src/workflow/index.ts";

describe("ReviewProtocolEngine Core State & Phase Progression", () => {
  const dummyTask: TaskRecord = {
    id: "task-test-01",
    status: "validating",
    requirement_ids: ["req-01"],
    write_scope: ["src/feature.ts"],
    dependencies: [],
    attempts: [],
    history: [],
    repair_round: 0,
    probe_round: 0,
  };

  test("initial flawless submission advances directly to cognitive deepening phase with 0 adversarial rounds used", () => {
    const state = projectTaskReviewState(dummyTask, DEFAULT_REVIEW_PROTOCOL_CONFIG);

    expect(state.current_phase).toBe("cognitive");
    expect(state.adversarial_rounds_used).toBe(0);
    expect(state.cognitive_rounds_completed).toBe(0);
    expect(state.cognitive_pushes_required).toBe(5);
    expect(state.can_finalize_review).toBe(false);
  });

  test("defect findings keep task in adversarial phase", () => {
    const taskWithBugs: TaskRecord = {
      ...dummyTask,
      repair_round: 1,
      findings: [
        {
          id: "finding-01",
          requirement_id: "req-01",
          severity: "important",
          observation: "Logic flaw in condition",
          evidence: [],
          remediation: "Fix condition",
          revalidation: "Run unit test",
          status: "open",
        },
      ],
    };

    const state = projectTaskReviewState(taskWithBugs, DEFAULT_REVIEW_PROTOCOL_CONFIG);

    expect(state.current_phase).toBe("adversarial");
    expect(state.adversarial_rounds_used).toBe(1);
    expect(state.can_finalize_review).toBe(false);
  });

  test("resolving defect findings transitions task into cognitive phase", () => {
    const taskResolvedBugs: TaskRecord = {
      ...dummyTask,
      repair_round: 2,
      findings: [
        {
          id: "finding-01",
          requirement_id: "req-01",
          severity: "important",
          observation: "Logic flaw in condition",
          evidence: [],
          remediation: "Fix condition",
          revalidation: "Run unit test",
          status: "resolved",
        },
      ],
    };

    const state = projectTaskReviewState(taskResolvedBugs, DEFAULT_REVIEW_PROTOCOL_CONFIG);

    expect(state.current_phase).toBe("cognitive");
    expect(state.adversarial_rounds_used).toBe(2);
    expect(state.can_finalize_review).toBe(false);
  });

  test("completing all required cognitive probes advances phase to completed and unlocks finalization", () => {
    const taskWithCompletedProbes: TaskRecord = {
      ...dummyTask,
      probe_round: 5,
    };

    const state = projectTaskReviewState(taskWithCompletedProbes, DEFAULT_REVIEW_PROTOCOL_CONFIG);

    expect(state.current_phase).toBe("completed");
    expect(state.cognitive_rounds_completed).toBe(5);
    expect(state.can_finalize_review).toBe(true);
    expect(canFinalizeReview(taskWithCompletedProbes, DEFAULT_REVIEW_PROTOCOL_CONFIG)).toBe(true);
  });

  test("exhausting max adversarial pushes triggers escalation flag", () => {
    const exhaustedTask: TaskRecord = {
      ...dummyTask,
      repair_round: 20,
      findings: [
        {
          id: "finding-05",
          requirement_id: "req-01",
          severity: "critical",
          observation: "Unresolved regression",
          evidence: [],
          remediation: "Redo patch",
          revalidation: "Run test",
          status: "open",
        },
      ],
    };

    const state = projectTaskReviewState(exhaustedTask, DEFAULT_REVIEW_PROTOCOL_CONFIG);

    expect(state.current_phase).toBe("adversarial");
    expect(state.exhausted_adversarial).toBe(true);
    expect(state.can_finalize_review).toBe(false);
  });

  test("cognitive probes do not penalize adversarial repair round budget", () => {
    const taskWithCognitiveProbes: TaskRecord = {
      ...dummyTask,
      repair_round: 0,
      probe_round: 2,
    };

    const state = projectTaskReviewState(taskWithCognitiveProbes, DEFAULT_REVIEW_PROTOCOL_CONFIG);

    expect(state.adversarial_rounds_used).toBe(0);
    expect(state.cognitive_rounds_completed).toBe(2);
    expect(state.exhausted_adversarial).toBe(false);
  });

  test("ReviewProtocolEngine recordEntry updates task history and review state", () => {
    const engine = new ReviewProtocolEngine({
      max_adversarial_pushes: 4,
      cognitive_pushes: 2,
    });

    const task: TaskRecord = { ...dummyTask };

    engine.recordEntry(task, {
      round: 1,
      channel: "cognitive",
      actor_id: "validator-1",
      verdict: "probe",
      probe_demands_count: 2,
      summary: "Probing zero-input edge case",
    });

    const history = (task as Record<string, unknown>)[
      "review_history"
    ] as readonly ReviewChannelEntry[];
    expect(history.length).toBe(1);
    expect(history[0]?.channel).toBe("cognitive");
    expect(history[0]?.actor_id).toBe("validator-1");

    const reviewState = (task as Record<string, unknown>)["review_state"] as {
      cognitive_rounds_completed: number;
      cognitive_pushes_required: number;
    };
    expect(reviewState.cognitive_rounds_completed).toBe(1);
    expect(reviewState.cognitive_pushes_required).toBe(2);
  });

  test("evaluateReviewPhase evaluates phase from task and history array", () => {
    expect(evaluateReviewPhase(dummyTask, DEFAULT_REVIEW_PROTOCOL_CONFIG)).toBe("cognitive");

    const taskWithBugs: TaskRecord = {
      ...dummyTask,
      findings: [
        {
          id: "f-open",
          requirement_id: "req-1",
          severity: "critical",
          observation: "bug",
          evidence: [],
          remediation: "fix",
          revalidation: "test",
          status: "open",
        },
      ],
    };
    expect(evaluateReviewPhase(taskWithBugs, DEFAULT_REVIEW_PROTOCOL_CONFIG)).toBe("adversarial");

    const completedHistory: ReviewChannelEntry[] = Array.from({ length: 5 }, (_, i) => ({
      round: i + 1,
      channel: "cognitive",
      actor_id: "val-1",
      verdict: "pass",
      timestamp: new Date().toISOString(),
    }));
    expect(evaluateReviewPhase(completedHistory, DEFAULT_REVIEW_PROTOCOL_CONFIG)).toBe("completed");
  });
});
