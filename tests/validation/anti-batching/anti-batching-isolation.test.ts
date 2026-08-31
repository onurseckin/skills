import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  validateCriticAntiBatching,
  validateReviewAntiBatching,
} from "../../../olt/scripts/src/validation/anti-batching.ts";
import {
  assertAntiBatchingRule,
  detectScopeCollisions,
  partitionCandidatesStrictly,
  partitionGroupedFeedbacksStrictly,
  partitionIntoDisjointWaves,
  synthesizeAutonomousTasks,
  validateAntiBatchingIsolation,
  type SmartTaskPlan,
} from "../../../olt/scripts/src/mind/tasks/smart/index.ts";
import {
  assertDefectCandidatesIsolated,
  assertDiscriminatingSignOffProofs,
  assertOneToOneImplementerValidatorIsolation,
  partitionDefectsToIsolatedTasks,
} from "../../../olt/scripts/src/orchestrator/anti-batching.ts";
import { validateReview } from "../../../olt/scripts/src/workflow/review/validate-review.ts";
import { parseCompletionAssessment } from "../../../olt/scripts/src/workflow/completion/review-input.ts";
import type { TaskRecord, WorkflowState } from "../../../olt/scripts/src/workflow/types.ts";
import type { FeedbackItem } from "../../../olt/scripts/src/mind/feedback/queue/index.ts";
import { tmpdir } from "node:os";

describe("Strict Anti-Batching Pipeline & 1:1 Isolated Implementer-Validator Verification", () => {
  const testDir = join(tmpdir(), "test-validation-anti-batching-" + Math.random().toString(36).slice(2));
  const feedbackFile = join(testDir, "FEEDBACK_QUEUE.jsonl");
  const taskQueueFile = join(testDir, "TASK_QUEUE.jsonl");

  function setup(): void {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  }

  function teardown(): void {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  }


  describe("3. 1:1 Implementer and Validator Assignment & Self-Validation Refusal", () => {
    it("rejects task plans where implementer is assigned as validator (self-validation)", () => {
      const selfValidatingPlan: SmartTaskPlan = {
        id: "task-self-val",
        label: "Self-Validating Task",
        write_scope: ["src/core.ts"],
        gate: "bun test",
        charter_goals: ["G1"],
        acceptance_criteria: ["Pass"],
        dependencies: [],
        source_type: "direct_prompt",
        rationale: "Self validation defect",
        assigned_implementer: "agent-alice",
        assigned_validator: "agent-alice",
      };

      const report = validateAntiBatchingIsolation([selfValidatingPlan]);
      expect(report.compliant).toBe(false);
      expect(
        report.violations.some((v) =>
          v.includes(
            "violates 1:1 isolation: implementer 'agent-alice' cannot act as independent validator",
          ),
        ),
      ).toBe(true);
    });

    it("rejects task plans with missing implementer or validator assignment", () => {
      const missingValidatorPlan: SmartTaskPlan = {
        id: "task-missing-val",
        label: "Missing Validator Task",
        write_scope: ["src/core.ts"],
        gate: "bun test",
        charter_goals: ["G1"],
        acceptance_criteria: ["Pass"],
        dependencies: [],
        source_type: "direct_prompt",
        rationale: "Missing validator",
        assigned_implementer: "agent-alice",
      };

      const report = validateAntiBatchingIsolation([missingValidatorPlan]);
      expect(report.compliant).toBe(false);
      expect(
        report.violations.some((v) => v.includes("missing an independent Validator assignment")),
      ).toBe(true);
    });

    it("assertOneToOneImplementerValidatorIsolation throws on matching implementer and validator", () => {
      expect(() => {
        assertOneToOneImplementerValidatorIsolation("worker-1", "worker-1", "task-xyz");
      }).toThrow(
        "Anti-batching violation: task 'task-xyz' assigned implementer 'worker-1' cannot validate its own task",
      );

      expect(() => {
        assertOneToOneImplementerValidatorIsolation("worker-1", "val-1", "task-xyz");
      }).not.toThrow();
    });
  });

  describe("4. Independent Write Scope Isolation & Wave Partitioning", () => {
    it("detects scope collisions across tasks with overlapping files", () => {
      const plans: readonly SmartTaskPlan[] = [
        {
          id: "t1",
          label: "Task 1",
          write_scope: ["scripts/src/engine.ts", "scripts/src/shared.ts"],
          gate: "bun test",
          charter_goals: ["G1"],
          acceptance_criteria: [],
          dependencies: [],
          source_type: "direct_prompt",
          rationale: "r1",
          assigned_implementer: "impl-1",
          assigned_validator: "val-1",
        },
        {
          id: "t2",
          label: "Task 2",
          write_scope: ["scripts/src/shared.ts", "scripts/src/utils.ts"],
          gate: "bun test",
          charter_goals: ["G1"],
          acceptance_criteria: [],
          dependencies: [],
          source_type: "direct_prompt",
          rationale: "r2",
          assigned_implementer: "impl-2",
          assigned_validator: "val-2",
        },
      ];

      const collisions = detectScopeCollisions(plans);
      expect(collisions.length).toBe(1);
      expect(collisions[0]!.scope).toBe("scripts/src/shared.ts");
      expect(collisions[0]!.task_ids).toEqual(["t1", "t2"]);
    });

    it("partitionIntoDisjointWaves pushes colliding tasks into sequential independent waves", () => {
      const plans: readonly SmartTaskPlan[] = [
        {
          id: "t1",
          label: "Task 1",
          write_scope: ["scripts/src/shared.ts"],
          gate: "bun test",
          charter_goals: ["G1"],
          acceptance_criteria: [],
          dependencies: [],
          source_type: "direct_prompt",
          rationale: "r1",
          assigned_implementer: "impl-1",
          assigned_validator: "val-1",
        },
        {
          id: "t2",
          label: "Task 2",
          write_scope: ["scripts/src/shared.ts"],
          gate: "bun test",
          charter_goals: ["G1"],
          acceptance_criteria: [],
          dependencies: [],
          source_type: "direct_prompt",
          rationale: "r2",
          assigned_implementer: "impl-2",
          assigned_validator: "val-2",
        },
        {
          id: "t3",
          label: "Task 3",
          write_scope: ["scripts/src/independent.ts"],
          gate: "bun test",
          charter_goals: ["G1"],
          acceptance_criteria: [],
          dependencies: [],
          source_type: "direct_prompt",
          rationale: "r3",
          assigned_implementer: "impl-3",
          assigned_validator: "val-3",
        },
      ];

      const wavePlan = partitionIntoDisjointWaves(plans);
      expect(wavePlan.total_waves).toBe(2);
      expect(wavePlan.waves[0]!.task_ids).toEqual(["t1", "t3"]);
      expect(wavePlan.waves[1]!.task_ids).toEqual(["t2"]);
    });
  });

  describe("5. Anti-Batching Discrimination Proof Enforcement in task:review", () => {
    const mockTaskMultiReq: TaskRecord = {
      id: "task-multi-req",
      title: "Multi-Requirement Task",
      status: "validating",
      write_scope: ["src/feature.ts"],
      gate: "bun test",
      requirement_ids: ["req-1", "req-2"],
      dependencies: [],
      repair_round: 0,
      original_implementer: "impl-1",
    };

    it("rejects passing review when claiming multiple requirements with insufficient/non-discriminating check proofs", () => {
      const batchedReviewAttempt = {
        verdict: "pass" as const,
        requirement_ids: ["req-1", "req-2"],
        checks: [{ command_id: "cmd-generic-check" }], // Only 1 check for 2 distinct requirements
        findings: [],
      };

      expect(() => {
        validateReview(mockTaskMultiReq, batchedReviewAttempt);
      }).toThrow(
        "anti-batching violation: passing review covers 2 requirements but only provides 1 check(s)",
      );

      const res = validateReviewAntiBatching(mockTaskMultiReq, batchedReviewAttempt);
      expect(res.valid).toBe(false);
      expect(res.violations.length).toBeGreaterThan(0);
    });

    it("accepts passing review when individual discriminating check proofs per requirement are provided", () => {
      const validDiscriminatingReview = {
        verdict: "pass" as const,
        requirement_ids: ["req-1", "req-2"],
        checks: [{ command_id: "cmd-check-req-1" }, { command_id: "cmd-check-req-2" }],
        findings: [],
      };

      const result = validateReview(mockTaskMultiReq, validDiscriminatingReview);
      expect(result.verdict).toBe("pass");
      expect(result.checks.length).toBe(2);

      const res = validateReviewAntiBatching(mockTaskMultiReq, validDiscriminatingReview);
      expect(res.valid).toBe(true);
      expect(res.violations.length).toBe(0);
    });

    it("rejects passing review when resolved findings lack individual command evidence", () => {
      const invalidResolutionReview = {
        verdict: "pass" as const,
        requirement_ids: ["req-1", "req-2"],
        checks: [{ command_id: "cmd-check-req-1" }, { command_id: "cmd-check-req-2" }],
        findings: [],
        resolved_findings: [
          {
            finding_id: "FINDING-1",
            method: "Fixed defect",
            evidence: [], // Missing evidence
          },
        ],
      };

      expect(() => {
        validateReview(mockTaskMultiReq, invalidResolutionReview);
      }).toThrow("revalidation evidence for FINDING-1 must contain");

      const res = validateReviewAntiBatching(mockTaskMultiReq, invalidResolutionReview);
      expect(res.valid).toBe(false);
    });

    it("assertDiscriminatingSignOffProofs utility function throws appropriately on insufficient proofs", () => {
      expect(() => {
        assertDiscriminatingSignOffProofs(
          "task-test",
          ["req-1", "req-2", "req-3"],
          [{ command_id: "cmd-1" }],
        );
      }).toThrow(
        "Anti-batching violation: task 'task-test' covers 3 requirements but only provides 1 check(s)",
      );

      expect(() => {
        assertDiscriminatingSignOffProofs(
          "task-test",
          ["req-1", "req-2"],
          [{ command_id: "cmd-1" }, { command_id: "cmd-2" }],
        );
      }).not.toThrow();
    });
  });

});
