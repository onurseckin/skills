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
  const testDir = join(
    tmpdir(),
    "test-validation-anti-batching-" + Math.random().toString(36).slice(2),
  );
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

  describe("1. Strict 1:1 Feedback & Directive Partitioning", () => {
    it("partitions multiple pending feedback items into strictly isolated 1:1 task nodes", () => {
      setup();
      const feedbacks: readonly FeedbackItem[] = [
        {
          id: "fb-opt-1",
          timestamp: new Date().toISOString(),
          title: "Optimize API Response Latency",
          content: "Reduce payload serialization overhead",
          priority: "CRITICAL_USER_FEEDBACK",
          category: "CORE_ENGINE",
          status: "PENDING",
        },
        {
          id: "fb-sec-2",
          timestamp: new Date().toISOString(),
          title: "Harden Bearer Token Validation",
          content: "Verify constant-time comparison on tokens",
          priority: "HIGH_ARCHITECTURAL_FEATURE",
          category: "CORE_ENGINE",
          status: "PENDING",
        },
        {
          id: "fb-cli-3",
          timestamp: new Date().toISOString(),
          title: "Add Verbose Logging to CLI Commands",
          content: "Support --verbose flag across CLI registry",
          priority: "USER_DIRECTIVE",
          category: "CLI_TOOLING",
          status: "PENDING",
        },
      ];

      writeFileSync(
        feedbackFile,
        feedbacks.map((f) => JSON.stringify(f)).join("\n") + "\n",
        "utf8",
      );

      const result = synthesizeAutonomousTasks({
        capsulesDir: feedbackFile,
        queuePath: taskQueueFile,
      });

      expect(result.mode).toBe("feedback_intake");
      expect(result.tasks.length).toBe(3);
      expect(result.anti_batching_enforced).toBe(true);

      // Verify every feedback item is mapped 1:1 to its own distinct task
      for (let i = 0; i < feedbacks.length; i++) {
        const fb = feedbacks[i]!;
        const task = result.tasks.find((t) => t.feedback_id === fb.id);
        expect(task).toBeDefined();
        expect(task?.label).toBe(fb.title);
        expect(task?.write_scope.length).toBeGreaterThan(0);
        expect(task?.assigned_implementer).toBeDefined();
        expect(task?.assigned_validator).toBeDefined();
        expect(task?.assigned_implementer).not.toBe(task?.assigned_validator);
      }

      teardown();
    });

    it("partitionGroupedFeedbacksStrictly enforces 1:1 node isolation and dedicated implementer/validator assignment", () => {
      const feedbacks: readonly FeedbackItem[] = [
        {
          id: "fb-alpha",
          title: "Directive Alpha",
          content: "Directive Alpha content",
          priority: "CRITICAL_USER_FEEDBACK",
          category: "CORE_ENGINE",
          status: "PENDING",
        },
        {
          id: "fb-beta",
          title: "Directive Beta",
          content: "Directive Beta content",
          priority: "NORMAL",
          category: "DOCUMENTATION",
          status: "PENDING",
        },
      ];

      const tasks = partitionGroupedFeedbacksStrictly(feedbacks, { baseIdPrefix: "isolated-task" });
      expect(tasks.length).toBe(2);

      expect(tasks[0]!.id).toContain("isolated-task-1-fb-alpha");
      expect(tasks[0]!.assigned_implementer).toBe("implementer-fb-alpha");
      expect(tasks[0]!.assigned_validator).toBe("validator-fb-alpha");

      expect(tasks[1]!.id).toContain("isolated-task-2-fb-beta");
      expect(tasks[1]!.assigned_implementer).toBe("implementer-fb-beta");
      expect(tasks[1]!.assigned_validator).toBe("validator-fb-beta");

      // Verify validation passes cleanly
      const report = validateAntiBatchingIsolation(tasks);
      expect(report.compliant).toBe(true);
      expect(report.violations.length).toBe(0);
      expect(report.isolated_task_count).toBe(2);
    });

    it("partitionCandidatesStrictly partitions defect candidates into 1:1 isolated task nodes", () => {
      const candidates = [
        { id: "cand-1", title: "Memory Leak in Event Chainer", category: "CORE_ENGINE" },
        { id: "cand-2", title: "Missing Error Boundary in Dashboard", category: "ARCHITECTURE" },
      ];

      const plans = partitionCandidatesStrictly(candidates, { baseIdPrefix: "cand-repair" });
      expect(plans.length).toBe(2);

      expect(plans[0]!.candidate_id).toBe("cand-1");
      expect(plans[0]!.assigned_implementer).toBe("implementer-cand-1");
      expect(plans[0]!.assigned_validator).toBe("validator-cand-1");

      expect(plans[1]!.candidate_id).toBe("cand-2");
      expect(plans[1]!.assigned_implementer).toBe("implementer-cand-2");
      expect(plans[1]!.assigned_validator).toBe("validator-cand-2");
    });
  });

  describe("2. Mechanical Rejection of Batched Multi-Item Tasks", () => {
    it("rejects task plans that merge multiple feedback IDs into a single task node", () => {
      const batchedPlan: SmartTaskPlan = {
        id: "task-batched-error",
        label: "Merged Multi-Item Task",
        write_scope: ["src/core.ts"],
        gate: "bun test",
        charter_goals: ["G1"],
        acceptance_criteria: ["Pass"],
        dependencies: [],
        source_type: "feedback_intake",
        rationale: "Merged multiple feedback items",
        assigned_implementer: "implementer-1",
        assigned_validator: "validator-1",
        metadata: {
          batched_feedback_ids: ["fb-1", "fb-2", "fb-3"],
        },
      };

      const report = validateAntiBatchingIsolation([batchedPlan]);
      expect(report.compliant).toBe(false);
      expect(
        report.violations.some((v) => v.includes("illegally merges multiple feedback items")),
      ).toBe(true);

      expect(() => {
        assertAntiBatchingRule([batchedPlan]);
      }).toThrow("Anti-Batching Rule violation");
    });

    it("rejects task plans with multi-item comma-separated feedback IDs or batch titles", () => {
      const commaPlan: SmartTaskPlan = {
        id: "task-comma-fb",
        label: "[Batch: 2 items] Fix multiple bugs",
        write_scope: ["src/core.ts"],
        gate: "bun test",
        charter_goals: ["G1"],
        acceptance_criteria: ["Pass"],
        dependencies: [],
        source_type: "feedback_intake",
        rationale: "Fixing fb-1 and fb-2 together",
        assigned_implementer: "implementer-1",
        assigned_validator: "validator-1",
        feedback_id: "fb-1, fb-2",
      };

      const report = validateAntiBatchingIsolation([commaPlan]);
      expect(report.compliant).toBe(false);
      expect(report.violations.some((v) => v.includes("declares multi-item feedback_id"))).toBe(
        true,
      );
      expect(report.violations.some((v) => v.includes("title indicates batched execution"))).toBe(
        true,
      );
    });

    it("rejects task plans with empty write scopes violating scope isolation", () => {
      const emptyScopePlan: SmartTaskPlan = {
        id: "task-no-scope",
        label: "Task Without Scope",
        write_scope: [],
        gate: "bun test",
        charter_goals: ["G1"],
        acceptance_criteria: ["Pass"],
        dependencies: [],
        source_type: "direct_prompt",
        rationale: "Missing scope",
        assigned_implementer: "implementer-1",
        assigned_validator: "validator-1",
      };

      const report = validateAntiBatchingIsolation([emptyScopePlan]);
      expect(report.compliant).toBe(false);
      expect(report.violations.some((v) => v.includes("empty write scope"))).toBe(true);
    });
  });
});
