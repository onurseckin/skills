import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import type { FeedbackItem } from "../../../../olt/scripts/src/mind/feedback/queue/index.ts";
import type { SmartTaskPlan } from "../../../../olt/scripts/src/mind/tasks/smart/planner/models.ts";
import {
  assertAntiBatchingRule,
  partitionGroupedFeedbacksStrictly,
  validateAntiBatchingIsolation,
  validateAntiBatchingRule,
} from "../../../../olt/scripts/src/mind/tasks/smart/planner/partitioning.ts";

const TEST_DIR = join(process.cwd(), ".tmp-test-partitioning-cov");

function createPlan(overrides: Partial<SmartTaskPlan> = {}): SmartTaskPlan {
  return {
    id: "task-p-1",
    label: "Task Partition 1",
    write_scope: ["olt/scripts/src/mind/tasks/file.ts"],
    gate: "bun test",
    charter_goals: ["G1"],
    acceptance_criteria: ["Pass gate"],
    dependencies: [],
    source_type: "feedback_intake",
    rationale: "Rationale",
    assigned_implementer: "implementer-1",
    assigned_validator: "validator-1",
    feedback_id: "fb-1",
    ...overrides,
  };
}

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("Partitioning & Anti-Batching Validation Suite", () => {
  describe("validateAntiBatchingRule & validateAntiBatchingIsolation", () => {
    it("validates compliant plan sets and alias compatibility", () => {
      const plan = createPlan();
      const report1 = validateAntiBatchingRule([plan]);
      expect(report1.compliant).toBe(true);
      expect(report1.violations).toEqual([]);
      expect(report1.isolated_task_count).toBe(1);

      const report2 = validateAntiBatchingIsolation([plan]);
      expect(report2.compliant).toBe(true);
    });

    it("detects duplicate task IDs and illegal multi-item metadata", () => {
      const p1 = createPlan({ id: "dup-1" });
      const p2 = createPlan({
        id: "dup-1",
        metadata: {
          batched_feedback_ids: ["fb-1", "fb-2"],
          batched_candidate_ids: ["cand-1", "cand-2"],
        },
      });
      const report = validateAntiBatchingRule([p1, p2]);
      expect(report.compliant).toBe(false);
      expect(report.violations.some((v) => v.includes("Duplicate task ID"))).toBe(true);
      expect(report.violations.some((v) => v.includes("illegally merges multiple feedback"))).toBe(
        true,
      );
      expect(report.violations.some((v) => v.includes("illegally merges multiple defect"))).toBe(
        true,
      );
    });

    it("detects comma-separated IDs, batch titles, and empty write scopes", () => {
      const p = createPlan({
        feedback_id: "fb-1,fb-2",
        candidate_id: "cand-1;cand-2",
        label: "[Batch] Refactor core",
        rationale: "[Multi-item] processing",
        write_scope: ["", "  "],
      });
      const report = validateAntiBatchingRule([p]);
      expect(report.compliant).toBe(false);
      expect(report.violations.some((v) => v.includes("declares multi-item feedback_id"))).toBe(
        true,
      );
      expect(report.violations.some((v) => v.includes("declares multi-item candidate_id"))).toBe(
        true,
      );
      expect(report.violations.some((v) => v.includes("title indicates batched execution"))).toBe(
        true,
      );
      expect(report.violations.some((v) => v.includes("contains empty string entry"))).toBe(true);

      const pEmpty = createPlan({ write_scope: [] });
      const reportEmpty = validateAntiBatchingRule([pEmpty]);
      expect(reportEmpty.violations.some((v) => v.includes("has empty write scope"))).toBe(true);
    });

    it("detects missing roles and self-validation violations", () => {
      const pMissing = createPlan({
        assigned_implementer: undefined,
        assigned_validator: undefined,
      });
      const reportMissing = validateAntiBatchingRule([pMissing]);
      expect(
        reportMissing.violations.some((v) => v.includes("missing a dedicated Implementer")),
      ).toBe(true);
      expect(
        reportMissing.violations.some((v) => v.includes("missing an independent Validator")),
      ).toBe(true);

      const pSameRole = createPlan({
        assigned_implementer: "agent-x",
        assigned_validator: "agent-x",
      });
      const reportSame = validateAntiBatchingRule([pSameRole]);
      expect(
        reportSame.violations.some((v) => v.includes("cannot act as independent validator")),
      ).toBe(true);
    });
  });

  describe("assertAntiBatchingRule", () => {
    it("passes on compliant plans and throws HarnessError on violations", () => {
      expect(() => assertAntiBatchingRule([createPlan()])).not.toThrow();
      expect(() =>
        assertAntiBatchingRule([
          createPlan({ assigned_implementer: "same", assigned_validator: "same" }),
        ]),
      ).toThrow(HarnessError);
    });
  });

  describe("partitionGroupedFeedbacksStrictly", () => {
    it("partitions feedback items 1:1, resolving scopes, gates, and overlap dependencies", () => {
      const feedbacks: FeedbackItem[] = [
        {
          id: "fb-wd-1",
          source: "code_review",
          title: "Fix watchdog timeout",
          content: "Watchdog timer leak",
          priority: "CRITICAL_USER_FEEDBACK",
          category: "WATCHDOG",
          timestamp: "2026-09-01T20:00:00.000Z",
          status: "pending",
        },
        {
          id: "fb-wd-2",
          source: "code_review",
          title: "Fix watchdog heartbeat",
          content: "Heartbeat interval adjustment",
          priority: "HIGH_ARCHITECTURAL_FEATURE",
          category: "WATCHDOG",
          timestamp: "2026-09-01T20:00:00.000Z",
          status: "pending",
        },
      ];

      const queuePath = join(TEST_DIR, "task-queue.json");
      const tasks = partitionGroupedFeedbacksStrictly(feedbacks, {
        baseIdPrefix: "smart-task",
        charterGoals: ["G_STABILITY"],
        autoEnqueue: true,
        queuePath,
      });

      expect(tasks).toHaveLength(2);
      expect(tasks[0]?.id).toBe("smart-task-1-fb-wd-1");
      expect(tasks[0]?.charter_goals).toEqual(["G_STABILITY"]);
      expect(tasks[0]?.priority).toBe("CRITICAL");
      expect(tasks[1]?.id).toBe("smart-task-2-fb-wd-2");
      expect(tasks[1]?.priority).toBe("HIGH");
      expect(tasks[1]?.dependencies).toContain("smart-task-1-fb-wd-1");
      expect(existsSync(queuePath)).toBe(true);
    });

    it("returns empty array when feedbacks is empty", () => {
      const result = partitionGroupedFeedbacksStrictly([]);
      expect(result).toEqual([]);
    });
  });
});
