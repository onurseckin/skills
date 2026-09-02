import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  executeAtomicAdmissionToDispatch,
  executeAtomicDispatch,
  executeProductOwnerAdmissionAndDispatch,
  reconcileAdmissionToDispatchState,
} from "../../../olt/scripts/src/mind/tasks/smart/executor/dispatch.ts";
import * as invariantsMod from "../../../olt/scripts/src/mind/tasks/smart/executor/invariants.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import type { FeedbackItem } from "../../../olt/scripts/src/mind/feedback/index.ts";
import type { TaskQueueItem } from "../../../olt/scripts/src/task/queue/index.ts";

describe("Smart Tasks Executor Dispatch (dispatch.ts)", () => {
  let tempDir: string;
  let feedbackFile: string;
  let taskQueueFile: string;
  const spies: Array<{ mockRestore: () => void }> = [];

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mind-dispatch-test-"));
    feedbackFile = join(tempDir, "FEEDBACK_QUEUE.jsonl");
    taskQueueFile = join(tempDir, "TASK_QUEUE.jsonl");
    writeFileSync(feedbackFile, "");
    writeFileSync(taskQueueFile, "");
  });

  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
    spies.length = 0;
    rmSync(tempDir, { recursive: true, force: true });
  });

  const writeFeedbacks = (items: FeedbackItem[]) => {
    writeFileSync(
      feedbackFile,
      items.map((i) => JSON.stringify(i)).join("\n") + (items.length ? "\n" : ""),
    );
  };

  const writeTasks = (items: TaskQueueItem[]) => {
    writeFileSync(
      taskQueueFile,
      items.map((i) => JSON.stringify(i)).join("\n") + (items.length ? "\n" : ""),
    );
  };

  const makeFeedback = (
    id: string,
    status: FeedbackItem["status"] = "PENDING",
    overrides: Partial<FeedbackItem> = {},
  ): FeedbackItem => ({
    id,
    title: `Title ${id}`,
    content: `Content ${id}`,
    category: "CORE_ENGINE",
    priority: "CRITICAL_USER_FEEDBACK",
    status,
    timestamp: new Date().toISOString(),
    ...overrides,
  });

  describe("executeAtomicAdmissionToDispatch", () => {
    it("handles empty feedback queue by returning empty arrays and audit report", () => {
      const result = executeAtomicAdmissionToDispatch({
        capsulesDir: feedbackFile,
        queuePath: taskQueueFile,
      });
      expect(result.synthesized_tasks).toHaveLength(0);
      expect(result.enqueued_tasks).toHaveLength(0);
      expect(result.admitted_feedbacks).toHaveLength(0);
      expect(result.summary).toContain("No pending feedback items");
      expect(result.audit_report.zero_paused_admitted).toBe(true);
    });

    it("atomically admits and enqueues pending feedback items", () => {
      writeFeedbacks([
        makeFeedback("fb-1", "PENDING"),
        makeFeedback("fb-2", "PENDING"),
        makeFeedback("fb-3", "PROCESSED"),
      ]);

      const result = executeAtomicAdmissionToDispatch({
        capsulesDir: feedbackFile,
        queuePath: taskQueueFile,
        charterGoals: ["goal-1"],
      });

      expect(result.synthesized_tasks).toHaveLength(2);
      expect(result.enqueued_tasks).toHaveLength(2);
      expect(result.admitted_feedbacks).toHaveLength(2);
      expect(result.audit_report.zero_paused_admitted).toBe(true);
      expect(result.summary).toContain("Atomically admitted and dispatched 2 feedback item(s)");
    });

    it("respects maxTasks and orchestratorIds staging options", () => {
      writeFeedbacks([
        makeFeedback("fb-1", "PENDING"),
        makeFeedback("fb-2", "PENDING"),
        makeFeedback("fb-3", "PENDING"),
      ]);

      const result = executeAtomicAdmissionToDispatch({
        capsulesDir: feedbackFile,
        queuePath: taskQueueFile,
        maxTasks: 2,
        orchestratorIds: ["orch-1", "orch-2"],
      });

      expect(result.synthesized_tasks).toHaveLength(2);
      expect(result.enqueued_tasks).toHaveLength(2);
      expect(result.synthesized_tasks[0]?.assigned_tier).toBe("Tier_1_Orchestrator");
    });

    it("uses explicit feedbackItems when provided", () => {
      const explicitFb = [makeFeedback("fb-explicit", "PENDING")];
      writeFeedbacks(explicitFb);
      const result = executeAtomicAdmissionToDispatch({
        capsulesDir: feedbackFile,
        queuePath: taskQueueFile,
        feedbackItems: explicitFb,
      });

      expect(result.synthesized_tasks).toHaveLength(1);
      expect(result.admitted_feedbacks).toHaveLength(1);
    });

    it("throws HarnessError when invariant verification fails", () => {
      writeFeedbacks([makeFeedback("fb-err", "PENDING")]);
      spies.push(
        spyOn(invariantsMod, "verifyAdmissionToDispatchInvariants").mockReturnValue({
          zero_paused_admitted: false,
          total_pending_feedbacks: 0,
          total_admitted_feedbacks: 1,
          total_enqueued_tasks: 0,
          paused_admitted_count: 1,
          violations: ["Invariant check failed: 1 admitted feedback is unassigned"],
          timestamp: new Date().toISOString(),
        }),
      );

      expect(() =>
        executeAtomicAdmissionToDispatch({
          capsulesDir: feedbackFile,
          queuePath: taskQueueFile,
        }),
      ).toThrow(HarnessError);
    });

    it("aliases executeAtomicDispatch and executeProductOwnerAdmissionAndDispatch cleanly", () => {
      const result1 = executeAtomicDispatch({
        capsulesDir: feedbackFile,
        queuePath: taskQueueFile,
      });
      const result2 = executeProductOwnerAdmissionAndDispatch({
        capsulesDir: feedbackFile,
        queuePath: taskQueueFile,
      });
      expect(result1.summary).toBe(result2.summary);
    });
  });

  describe("reconcileAdmissionToDispatchState", () => {
    it("commits PREPARED feedbacks when matching task exists in queue", () => {
      const preparedFb: FeedbackItem = {
        ...makeFeedback("fb-prep", "PENDING"),
        metadata: {
          feedback_dispatch_state: "PREPARED",
          feedback_dispatch_task_id: "task-fb-prep",
        },
      };
      writeFeedbacks([preparedFb]);

      const matchingTask: TaskQueueItem = {
        id: "task-fb-prep",
        title: "Task FB Prep",
        description: "Task desc",
        category: "CORE_ENGINE",
        write_scope: ["src/a.ts"],
        gate: "bun test",
        dependencies: [],
        status: "PENDING",
        priority: "HIGH",
        created_at: new Date().toISOString(),
        metadata: { feedback_id: "fb-prep" },
      };
      writeTasks([matchingTask]);

      const res = reconcileAdmissionToDispatchState({
        capsulesDir: feedbackFile,
        queuePath: taskQueueFile,
      });

      expect(res.reconciled_feedbacks_count).toBe(1);
      expect(res.newly_enqueued_tasks_count).toBe(0);
      expect(res.audit_report.zero_paused_admitted).toBe(true);
    });

    it("returns zero counts when state is already valid with zero paused admitted", () => {
      writeFeedbacks([]);
      writeTasks([]);

      const res = reconcileAdmissionToDispatchState({
        capsulesDir: feedbackFile,
        queuePath: taskQueueFile,
      });

      expect(res.reconciled_feedbacks_count).toBe(0);
      expect(res.newly_enqueued_tasks_count).toBe(0);
      expect(res.audit_report.zero_paused_admitted).toBe(true);
    });

    it("returns zero counts when invariant fails but no orphaned feedbacks exist", () => {
      writeFeedbacks([makeFeedback("fb-done", "PROCESSED")]);
      writeTasks([]);

      spies.push(
        spyOn(invariantsMod, "verifyAdmissionToDispatchInvariants").mockReturnValue({
          zero_paused_admitted: false,
          total_pending_feedbacks: 0,
          total_admitted_feedbacks: 0,
          total_enqueued_tasks: 0,
          paused_admitted_count: 0,
          violations: ["Manual violation"],
          timestamp: new Date().toISOString(),
        }),
      );

      const res = reconcileAdmissionToDispatchState({
        capsulesDir: feedbackFile,
        queuePath: taskQueueFile,
      });

      expect(res.reconciled_feedbacks_count).toBe(0);
      expect(res.newly_enqueued_tasks_count).toBe(0);
    });

    it("re-dispatches orphaned ADMITTED feedbacks missing from task queue", () => {
      const orphanedFb: FeedbackItem = {
        ...makeFeedback("fb-orphan", "ADMITTED"),
        metadata: { dispatched_task_id: "task-missing" },
      };
      writeFeedbacks([orphanedFb]);
      writeTasks([]);

      spies.push(
        spyOn(invariantsMod, "verifyAdmissionToDispatchInvariants")
          .mockReturnValueOnce({
            zero_paused_admitted: false,
            total_pending_feedbacks: 0,
            total_admitted_feedbacks: 1,
            total_enqueued_tasks: 0,
            paused_admitted_count: 1,
            violations: ["Orphaned feedback"],
            timestamp: new Date().toISOString(),
          })
          .mockReturnValue({
            zero_paused_admitted: true,
            total_pending_feedbacks: 0,
            total_admitted_feedbacks: 1,
            total_enqueued_tasks: 1,
            paused_admitted_count: 0,
            violations: [],
            timestamp: new Date().toISOString(),
          }),
      );

      const res = reconcileAdmissionToDispatchState({
        capsulesDir: feedbackFile,
        queuePath: taskQueueFile,
        charterGoals: ["goal-orphan"],
      });

      expect(res.reconciled_feedbacks_count).toBe(1);
      expect(res.newly_enqueued_tasks_count).toBe(1);
      expect(res.audit_report.zero_paused_admitted).toBe(true);
    });
  });
});
