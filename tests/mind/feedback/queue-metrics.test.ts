import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  admitAndDispatchFeedbackAtomically,
  auditAdmissionDispatchIntegrity,
  migrateFeedbackQueue,
  reconcilePausedAdmittedFeedbacks,
} from "../../../olt/scripts/src/mind/feedback/queue/metrics.ts";
import type { FeedbackItem } from "../../../olt/scripts/src/mind/feedback/queue/types.ts";
import { writeFeedbackQueue } from "../../../olt/scripts/src/mind/feedback/queue/admission.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Feedback Queue Metrics & Admission Suite", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  const testDir = "/virtual/feedback-metrics-test";
  const queuePath = `${testDir}/backlog.jsonl`;
  const taskQueuePath = `${testDir}/tasks.jsonl`;

  const sampleItem: FeedbackItem = {
    id: "fb-100",
    timestamp: "2026-09-01T12:00:00.000Z",
    priority: "CRITICAL_USER_FEEDBACK",
    status: "PENDING",
    category: "ENGINE",
    title: "Kernel panic fix",
    content: "Resolve lock contention in scheduler",
    metadata: { source: "telemetry" },
  };

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    vfs.mkdirSync(testDir, { recursive: true });
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    session.cleanup();
  });

  describe("admitAndDispatchFeedbackAtomically", () => {
    it("admits and dispatches an existing item referenced by string ID", () => {
      writeFeedbackQueue([sampleItem], queuePath);
      const res = admitAndDispatchFeedbackAtomically(
        "fb-100",
        (_item) => ({ taskId: "task-abc-1", metadata: { dispatcher_note: "dispatched" } }),
        queuePath,
      );
      expect(res.dispatched_task_id).toBe("task-abc-1");
      expect(res.auto_enqueued).toBe(true);
      expect(res.feedback_item.status).toBe("ADMITTED");
      expect(res.feedback_item.metadata?.["dispatched_task_id"]).toBe("task-abc-1");
      expect(res.feedback_item.metadata?.["dispatcher_note"]).toBe("dispatched");
      expect(res.feedback_item.metadata?.["source"]).toBe("telemetry");
      expect(res.feedback_item.processed_at).toBeTruthy();
    });

    it("throws INVALID_STATE when item ID string is not in the queue", () => {
      expect(() => {
        admitAndDispatchFeedbackAtomically("fb-nonexistent", () => ({ taskId: "t-1" }), queuePath);
      }).toThrow(HarnessError);
    });

    it("throws INVALID_STATE if item is removed concurrently before transaction", () => {
      writeFeedbackQueue([sampleItem], queuePath);
      expect(() => {
        admitAndDispatchFeedbackAtomically(
          "fb-100",
          () => {
            writeFeedbackQueue([], queuePath);
            return { taskId: "task-concurrent-1" };
          },
          queuePath,
        );
      }).toThrow("not found in queue");
    });

    it("admits and dispatches an existing item provided as an object", () => {
      writeFeedbackQueue([sampleItem], queuePath);
      const res = admitAndDispatchFeedbackAtomically(
        {
          id: "fb-100",
          priority: "CRITICAL_USER_FEEDBACK",
          category: "ENGINE",
          title: "Updated Title",
          content: "Updated Content",
        },
        (_item) => ({ taskId: "task-obj-1", autoEnqueued: false }),
        queuePath,
      );
      expect(res.dispatched_task_id).toBe("task-obj-1");
      expect(res.auto_enqueued).toBe(false);
      expect(res.feedback_item.title).toBe("Updated Title");
      expect(res.feedback_item.status).toBe("ADMITTED");
    });

    it("admits and dispatches a brand new item provided as an object", () => {
      const res = admitAndDispatchFeedbackAtomically(
        {
          id: "fb-new-1",
          priority: "NORMAL",
          category: "GENERAL",
          title: "New feedback",
          content: "Brand new content",
          status: "PENDING",
          timestamp: "2026-09-01T10:00:00.000Z",
        },
        () => ({ taskId: "task-new-1" }),
        queuePath,
      );
      expect(res.feedback_item.id).toBe("fb-new-1");
      expect(res.feedback_item.status).toBe("ADMITTED");
      expect(res.dispatched_task_id).toBe("task-new-1");
    });

    it("admits a brand new item with default status and timestamp when omitted", () => {
      const res = admitAndDispatchFeedbackAtomically(
        {
          id: "fb-new-2",
          priority: "LOW",
          category: "DOCUMENTATION",
          title: "Omitted defaults",
          content: "Content with defaults",
        },
        () => ({ taskId: "task-new-2" }),
        queuePath,
      );
      expect(res.feedback_item.id).toBe("fb-new-2");
      expect(res.feedback_item.status).toBe("ADMITTED");
      expect(res.feedback_item.timestamp).toBeTruthy();
    });

    it("throws INTEGRITY error when dispatcher returns an empty taskId", () => {
      writeFeedbackQueue([sampleItem], queuePath);
      expect(() => {
        admitAndDispatchFeedbackAtomically("fb-100", () => ({ taskId: "   " }), queuePath);
      }).toThrow("Atomic admission-to-dispatch failure");
    });
  });

  describe("auditAdmissionDispatchIntegrity", () => {
    it("returns compliant report when queue is empty", () => {
      const report = auditAdmissionDispatchIntegrity({
        feedbackPath: queuePath,
        taskQueuePath,
      });
      expect(report.is_compliant).toBe(true);
      expect(report.total_feedback_items).toBe(0);
      expect(report.admitted_feedback_count).toBe(0);
      expect(report.violations).toHaveLength(0);
    });

    it("returns compliant report when items are PENDING or COMPLETED", () => {
      writeFeedbackQueue([sampleItem], queuePath);
      const report = auditAdmissionDispatchIntegrity({
        feedbackPath: queuePath,
        taskQueuePath,
      });
      expect(report.is_compliant).toBe(true);
      expect(report.total_feedback_items).toBe(1);
      expect(report.admitted_feedback_count).toBe(0);
    });

    it("detects violations when ADMITTED items lack corresponding task entries", () => {
      writeFeedbackQueue([{ ...sampleItem, id: "fb-paused", status: "ADMITTED" }], queuePath);
      const report = auditAdmissionDispatchIntegrity({
        feedbackPath: queuePath,
        taskQueuePath,
      });
      expect(report.is_compliant).toBe(false);
      expect(report.admitted_feedback_count).toBe(1);
      expect(report.paused_admitted_feedback_count).toBe(1);
      expect(report.paused_admitted_feedbacks[0]?.id).toBe("fb-paused");
      expect(report.violations[0]).toContain("is paused without an enqueued/dispatched task node");
    });

    it("resolves tasks by dispatched_task_id, feedback_id, and batched_feedback_ids", () => {
      writeFeedbackQueue(
        [
          {
            ...sampleItem,
            id: "fb-1",
            status: "ADMITTED",
            metadata: { dispatched_task_id: "t-1" },
          },
          { ...sampleItem, id: "fb-2", status: "ADMITTED" },
          { ...sampleItem, id: "fb-3", status: "ADMITTED" },
        ],
        queuePath,
      );
      const taskLines = [
        JSON.stringify({ id: "t-1", status: "RUNNING" }),
        JSON.stringify({ id: "t-2", status: "PENDING", metadata: { feedback_id: "fb-2" } }),
        JSON.stringify({ id: "t-3", metadata: { batched_feedback_ids: "fb-3" } }),
        "   ",
        "invalid json line",
        JSON.stringify({ not_a_valid_task: true }),
      ].join("\n");
      vfs.writeFileSync(taskQueuePath, taskLines);

      const report = auditAdmissionDispatchIntegrity({
        feedbackPath: queuePath,
        taskQueuePath,
      });
      expect(report.is_compliant).toBe(true);
      expect(report.active_dispatched_feedback_count).toBe(3);
      expect(report.paused_admitted_feedback_count).toBe(0);
    });
  });

  describe("reconcilePausedAdmittedFeedbacks", () => {
    it("returns zero reconciled count when no items are paused", () => {
      writeFeedbackQueue([sampleItem], queuePath);
      const res = reconcilePausedAdmittedFeedbacks({ feedbackPath: queuePath, taskQueuePath });
      expect(res.reconciled_count).toBe(0);
      expect(res.remediated_feedbacks).toHaveLength(0);
    });

    it("reconciles paused admitted feedbacks by keeping ADMITTED and clearing processed_at", () => {
      writeFeedbackQueue(
        [{ ...sampleItem, status: "ADMITTED", processed_at: "2026-09-01T12:00:00.000Z" }],
        queuePath,
      );
      const res = reconcilePausedAdmittedFeedbacks({
        feedbackPath: queuePath,
        taskQueuePath,
        resetToPending: false,
      });
      expect(res.reconciled_count).toBe(1);
      expect(res.remediated_feedbacks[0]?.status).toBe("ADMITTED");
      expect(res.remediated_feedbacks[0]?.processed_at).toBeNull();
    });

    it("reconciles paused admitted feedbacks by resetting status to PENDING", () => {
      writeFeedbackQueue(
        [{ ...sampleItem, status: "ADMITTED", processed_at: "2026-09-01T12:00:00.000Z" }],
        queuePath,
      );
      const res = reconcilePausedAdmittedFeedbacks({
        feedbackPath: queuePath,
        taskQueuePath,
        resetToPending: true,
      });
      expect(res.reconciled_count).toBe(1);
      expect(res.remediated_feedbacks[0]?.status).toBe("PENDING");
      expect(res.remediated_feedbacks[0]?.processed_at).toBeNull();
    });
  });

  describe("migrateFeedbackQueue", () => {
    it("returns migrated: false when source path does not exist", () => {
      const res = migrateFeedbackQueue({
        sourcePath: `${testDir}/nonexistent.jsonl`,
        targetPath: queuePath,
      });
      expect(res.migrated).toBe(false);
      expect(res.count).toBe(0);
    });

    it("returns migrated: false when source and target are identical", () => {
      writeFeedbackQueue([sampleItem], queuePath);
      const res = migrateFeedbackQueue({ sourcePath: queuePath, targetPath: queuePath });
      expect(res.migrated).toBe(false);
      expect(res.count).toBe(0);
    });

    it("returns migrated: false when source queue has 0 records", () => {
      const emptySource = `${testDir}/empty.jsonl`;
      vfs.writeFileSync(emptySource, "");
      const res = migrateFeedbackQueue({ sourcePath: emptySource, targetPath: queuePath });
      expect(res.migrated).toBe(false);
      expect(res.count).toBe(0);
    });

    it("successfully migrates and merges records into target queue", () => {
      const srcQueue = `${testDir}/source.jsonl`;
      writeFeedbackQueue([{ ...sampleItem, id: "fb-tgt-1", title: "Target" }], queuePath);
      writeFeedbackQueue([{ ...sampleItem, id: "fb-src-1", title: "Source" }], srcQueue);
      const res = migrateFeedbackQueue({ sourcePath: srcQueue, targetPath: queuePath });
      expect(res.migrated).toBe(true);
      expect(res.count).toBe(1);
    });
  });
});
