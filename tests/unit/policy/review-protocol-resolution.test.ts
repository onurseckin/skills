import { describe, expect, test } from "bun:test";
import {
  assertReviewProtocolSatisfied,
  canFinalizeReview,
  projectTaskReviewState,
  resolveReviewProtocolConfig,
  ReviewProtocolEngine,
  type RepoPolicy,
  type ReviewProtocolConfig,
} from "../../../olt/scripts/src/policy/index.ts";
import type { TaskRecord } from "../../../olt/scripts/src/workflow/index.ts";
import type { AgentMetadata } from "../../../olt/scripts/src/runtime/index.ts";

describe("ReviewProtocolEngine Config Resolution & Satisfaction", () => {
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
    expect(resolved.cognitive_pushes).toBe(4);
    expect(resolved.escalate_on_exhausted_adversarial).toBe(true);
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
    expect(engine.evaluatePhase(cleanTask)).toBe("completed");
    expect(() => engine.assertSatisfied(cleanTask)).not.toThrow();
  });

  test("assertReviewProtocolSatisfied throws on unsatisfied conditions and passes when clean", () => {
    const exhaustedTask: TaskRecord = {
      ...dummyTask,
      repair_round: 20,
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

    expect(() =>
      assertReviewProtocolSatisfied(exhaustedTask, {
        max_adversarial_pushes: 10,
        cognitive_pushes: 2,
        escalate_on_exhausted_adversarial: true,
      }),
    ).toThrow(/Maximum adversarial defect repair rounds/i);

    const taskWithOpenFindings: TaskRecord = {
      ...dummyTask,
      repair_round: 1,
      findings: [
        {
          id: "f-1",
          requirement_id: "req-1",
          severity: "minor",
          observation: "typo",
          evidence: [],
          remediation: "fix",
          revalidation: "test",
          status: "open",
        },
      ],
    };

    expect(() =>
      assertReviewProtocolSatisfied(taskWithOpenFindings, {
        max_adversarial_pushes: 10,
        cognitive_pushes: 2,
      }),
    ).toThrow(/open finding\(s\) remain unresolved/i);

    expect(() =>
      assertReviewProtocolSatisfied(
        taskWithOpenFindings,
        { max_adversarial_pushes: 10, cognitive_pushes: 2 },
        ["f-1"],
      ),
    ).toThrow(/Cognitive deepening protocol not satisfied/i);
  });

  test("ReviewProtocolEngine recordEntry supports explicit timestamp and partial config", () => {
    const engine = new ReviewProtocolEngine();
    const task: TaskRecord = { ...dummyTask, review_history: [] };

    const entry = engine.recordEntry(task, {
      round: 1,
      channel: "adversarial",
      actor_id: "val-1",
      verdict: "pass",
      timestamp: "2026-08-24T00:00:00.000Z",
    });

    expect(entry.timestamp).toBe("2026-08-24T00:00:00.000Z");
    expect(entry.verdict).toBe("pass");
  });
});
