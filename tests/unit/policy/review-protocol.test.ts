import { describe, expect, test } from "bun:test";
import {
  canFinalizeReview,
  DEFAULT_REVIEW_PROTOCOL_CONFIG,
  evaluateReviewPhase,
  projectTaskReviewState,
  resolveReviewProtocolConfig,
  ReviewProtocolEngine,
  type ReviewChannelEntry,
  type ReviewProtocolConfig,
} from "../../../orchestrating-long-tasks/scripts/src/policy/review-protocol.ts";
import type { TaskRecord } from "../../../orchestrating-long-tasks/scripts/src/workflow/types.ts";
import type { RepoPolicy } from "../../../orchestrating-long-tasks/scripts/src/policy/repo-policy.ts";
import type { AgentMetadata } from "../../../orchestrating-long-tasks/scripts/src/runtime/agent-metadata.ts";

describe("ReviewProtocolEngine & Dual-Channel Review Protocol", () => {
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
    expect(state.cognitive_pushes_required).toBe(3);
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
      probe_round: 3,
    };

    const state = projectTaskReviewState(taskWithCompletedProbes, DEFAULT_REVIEW_PROTOCOL_CONFIG);

    expect(state.current_phase).toBe("completed");
    expect(state.cognitive_rounds_completed).toBe(3);
    expect(state.can_finalize_review).toBe(true);
    expect(canFinalizeReview(taskWithCompletedProbes, DEFAULT_REVIEW_PROTOCOL_CONFIG)).toBe(true);
  });

  test("exhausting max adversarial pushes triggers escalation flag", () => {
    const exhaustedTask: TaskRecord = {
      ...dummyTask,
      repair_round: 5,
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

  test("resolveReviewProtocolConfig merges 3-tier fallback correctly", () => {
    const mockRepoPolicy: RepoPolicy = {
      schema_version: 1,
      ecosystem: "bun",
      test_runner: {
        default_command: "bun test",
        targeted_pattern: "bun test <path>",
        full_suite_command: "bun test",
      },
      review_protocol: {
        max_adversarial_pushes: 7,
        cognitive_pushes: 4,
      },
    };

    const mockAgentMetadata: AgentMetadata = {
      agent_id: "val-1",
      role: "validator",
      tier: 3,
      write_scope: [],
      allowed_read_scope: [],
      can_execute_shell: false,
      spawned_at: new Date().toISOString(),
      metadata: {
        review_config: {
          cognitive_pushes: 6,
        },
      },
    };

    const resolved = resolveReviewProtocolConfig(mockRepoPolicy, mockAgentMetadata);

    expect(resolved.max_adversarial_pushes).toBe(7);
    expect(resolved.cognitive_pushes).toBe(4); // Repo policy takes precedence over agent metadata
    expect(resolved.escalate_on_exhausted_adversarial).toBe(true); // Defaults merged cleanly
  });

  test("resolveReviewProtocolConfig falls back to agent metadata when repo policy omits review_protocol", () => {
    const mockRepoPolicyNoRP: RepoPolicy = {
      schema_version: 1,
      ecosystem: "bun",
      test_runner: {
        default_command: "bun test",
        targeted_pattern: "bun test <path>",
        full_suite_command: "bun test",
      },
    };

    const mockAgentMetadata: AgentMetadata = {
      agent_id: "val-2",
      role: "validator",
      tier: 3,
      write_scope: [],
      allowed_read_scope: [],
      can_execute_shell: false,
      spawned_at: new Date().toISOString(),
      metadata: {
        review_config: {
          max_adversarial_pushes: 8,
          cognitive_pushes: 5,
        },
      },
    };

    const resolved = resolveReviewProtocolConfig(mockRepoPolicyNoRP, mockAgentMetadata);

    expect(resolved.max_adversarial_pushes).toBe(8);
    expect(resolved.cognitive_pushes).toBe(5);
  });

  test("boundary condition N=0 cognitive pushes allows immediate pass with 0 probes required", () => {
    const configN0: ReviewProtocolConfig = {
      max_adversarial_pushes: 5,
      cognitive_pushes: 0,
      escalate_on_exhausted_adversarial: true,
    };

    const cleanTask: TaskRecord = { ...dummyTask, probe_round: 0 };
    const state = projectTaskReviewState(cleanTask, configN0);

    expect(state.cognitive_pushes_required).toBe(0);
    expect(state.current_phase).toBe("completed");
    expect(state.can_finalize_review).toBe(true);
    expect(canFinalizeReview(cleanTask, configN0)).toBe(true);
  });

  test("cognitive_pushes: 0 in ReviewProtocolEngine allows immediate finalization without probes", () => {
    const engine = new ReviewProtocolEngine({
      max_adversarial_pushes: 5,
      cognitive_pushes: 0,
    });

    const cleanTask: TaskRecord = { ...dummyTask, probe_round: 0 };
    const state = engine.projectState(cleanTask);

    expect(state.cognitive_pushes_required).toBe(0);
    expect(state.current_phase).toBe("completed");
    expect(engine.canFinalize(cleanTask)).toBe(true);
    expect(() => engine.assertSatisfied(cleanTask)).not.toThrow();
  });
});
