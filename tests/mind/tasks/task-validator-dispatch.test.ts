import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
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
import {
  VirtualMemoryFS,
  createVirtualFSSession,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Mind Tasks: Task Validator Dispatch & Two-Phase Admission", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  let tempDir: string;
  let feedbackFile: string;
  let taskQueueFile: string;
  const spies: Array<{ mockRestore: () => void }> = [];

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
    tempDir = `/virtual/mind-validator-dispatch-${Date.now()}`;
    feedbackFile = join(tempDir, "FEEDBACK_QUEUE.jsonl");
    taskQueueFile = join(tempDir, "TASK_QUEUE.jsonl");
    vfs.mkdirSync(tempDir, { recursive: true });
    vfs.writeFileSync(feedbackFile, "");
    vfs.writeFileSync(taskQueueFile, "");
  });

  afterEach(() => {
    for (const spy of spies) {
      try {
        spy.mockRestore();
      } catch {}
    }
    spies.length = 0;
    session.cleanup();
  });

  const writeFeedbacks = (items: FeedbackItem[]) => {
    vfs.writeFileSync(
      feedbackFile,
      items.map((i) => JSON.stringify(i)).join("\n") + (items.length ? "\n" : ""),
    );
  };

  const writeTasks = (items: TaskQueueItem[]) => {
    vfs.writeFileSync(
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
    it("handles empty feedback queue returning clean audit report with zero_paused_admitted", () => {
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

    it("atomically admits and enqueues pending feedback items into task queue", () => {
      writeFeedbacks([
        makeFeedback("fb-val-1", "PENDING"),
        makeFeedback("fb-val-2", "PENDING"),
        makeFeedback("fb-val-3", "PROCESSED"),
      ]);

      const result = executeAtomicAdmissionToDispatch({
        capsulesDir: feedbackFile,
        queuePath: taskQueueFile,
        charterGoals: ["Zero Disk IO"],
      });

      expect(result.synthesized_tasks).toHaveLength(2);
      expect(result.enqueued_tasks).toHaveLength(2);
      expect(result.admitted_feedbacks).toHaveLength(2);
      expect(result.audit_report.zero_paused_admitted).toBe(true);
      expect(result.summary).toContain("Atomically admitted and dispatched 2 feedback item(s)");
    });

    it("respects maxTasks and orchestratorIds staging options", () => {
      writeFeedbacks([
        makeFeedback("fb-val-1", "PENDING"),
        makeFeedback("fb-val-2", "PENDING"),
        makeFeedback("fb-val-3", "PENDING"),
      ]);

      const result = executeAtomicAdmissionToDispatch({
        capsulesDir: feedbackFile,
        queuePath: taskQueueFile,
        maxTasks: 2,
        orchestratorIds: ["orch-val-1", "orch-val-2", "orch-val-3"],
      });

      expect(result.synthesized_tasks).toHaveLength(2);
      expect(result.enqueued_tasks).toHaveLength(2);
      expect(result.synthesized_tasks[0]?.assigned_tier).toBe("Tier_1_Orchestrator");
      expect(["orch-val-1", "orch-val-2", "orch-val-3"]).toContain(
        result.synthesized_tasks[0]?.metadata?.assigned_orchestrator as string,
      );
    });

    it("throws HarnessError when invariant verification fails", () => {
      writeFeedbacks([makeFeedback("fb-val-fail", "PENDING")]);
      spies.push(
        spyOn(invariantsMod, "verifyAdmissionToDispatchInvariants").mockReturnValue({
          is_compliant: false,
          total_feedback_items: 1,
          admitted_feedback_count: 1,
          paused_admitted_feedback_count: 1,
          paused_admitted_feedbacks: [makeFeedback("fb-val-fail", "ADMITTED")],
          active_dispatched_feedback_count: 0,
          violations: ["Violation: Paused admitted feedback exists"],
          zero_paused_admitted: false,
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
        ...makeFeedback("fb-rec-1", "PENDING"),
        metadata: {
          feedback_dispatch_state: "PREPARED",
          feedback_dispatch_task_id: "task-rec-1",
        },
      };
      writeFeedbacks([preparedFb]);

      const matchingTask: TaskQueueItem = {
        id: "task-rec-1",
        title: "Task 1",
        description: "Task desc",
        category: "CORE_ENGINE",
        write_scope: ["src/state.ts"],
        gate: "bun test",
        dependencies: [],
        status: "PENDING",
        priority: "HIGH",
        created_at: new Date().toISOString(),
        metadata: { feedback_id: "fb-rec-1" },
      };
      writeTasks([matchingTask]);

      const report = reconcileAdmissionToDispatchState({
        capsulesDir: feedbackFile,
        queuePath: taskQueueFile,
      });

      expect(report.reconciled_feedbacks_count).toBe(1);
      expect(report.newly_enqueued_tasks_count).toBe(0);
      expect(report.audit_report.zero_paused_admitted).toBe(true);
      const updated = JSON.parse(vfs.readFileSync(feedbackFile, "utf8").trim());
      expect(updated.metadata?.feedback_dispatch_state).toBe("COMMITTED");
      expect(updated.metadata?.feedback_dispatch_task_id).toBe("task-rec-1");
      expect(typeof updated.metadata?.feedback_dispatch_committed_at).toBe("string");
    });

    it("re-dispatches orphaned ADMITTED feedbacks missing from task queue", () => {
      const orphanedFb: FeedbackItem = {
        ...makeFeedback("fb-orphan-1", "ADMITTED"),
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

      const report = reconcileAdmissionToDispatchState({
        capsulesDir: feedbackFile,
        queuePath: taskQueueFile,
        charterGoals: ["goal-orphan"],
      });

      expect(report.reconciled_feedbacks_count).toBe(1);
      expect(report.newly_enqueued_tasks_count).toBe(1);
      expect(report.audit_report.zero_paused_admitted).toBe(true);
    });
  });

  describe("Session Isolation & Teardown Security", () => {
    it("session.cleanup() hermetically restores spies without global leak", () => {
      const isolatedVfs = new VirtualMemoryFS();
      const isolatedSession = createVirtualFSSession(isolatedVfs);

      isolatedVfs.mkdirSync("/virtual/sub", { recursive: true });
      isolatedVfs.writeFileSync("/virtual/sub/item.txt", "content");
      expect(isolatedVfs.existsSync("/virtual/sub/item.txt")).toBe(true);

      isolatedSession.cleanup();
      expect(isolatedVfs.existsSync("/virtual/sub/item.txt")).toBe(false);
      expect(isolatedSession.spies.length).toBeGreaterThan(0);
    });
  });
});
