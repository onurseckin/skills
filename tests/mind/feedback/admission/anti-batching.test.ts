import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  auditAdmissionDispatchIntegrity,
  reconcilePausedAdmittedFeedbacks,
} from "../../../../olt/scripts/src/mind/feedback/queue/metrics.ts";
import { appendFeedbackItem } from "../../../../olt/scripts/src/mind/feedback/queue/ops.ts";
import { readFeedbackQueue } from "../../../../olt/scripts/src/mind/feedback/queue/ingest.ts";
import type { FeedbackItem } from "../../../../olt/scripts/src/mind/feedback/queue/types.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Mind Feedback Admission Anti-Batching Suite", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  const testDir = "/virtual/mind/feedback/admission";
  const queuePath = `${testDir}/anti-batching.jsonl`;
  const taskQueuePath = `${testDir}/tasks.jsonl`;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    vfs.mkdirSync(testDir, { recursive: true });
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    session.cleanup();
  });

  function makeItem(id: string, overrides: Partial<FeedbackItem> = {}): FeedbackItem {
    return {
      id,
      timestamp: "2026-09-01T10:00:00.000Z",
      priority: "NORMAL",
      category: "GENERAL",
      status: "PENDING",
      title: `Item ${id}`,
      content: `Content for ${id}`,
      ...overrides,
    };
  }

  function writeTaskQueue(
    tasks: Array<{ id: string; status?: string; metadata?: Record<string, unknown> }>,
  ): void {
    const raw = tasks.map((t) => JSON.stringify(t)).join("\n") + (tasks.length ? "\n" : "");
    vfs.writeFileSync(taskQueuePath, raw);
  }

  describe("Granular Provenance Invariants", () => {
    it("preserves distinct ID, timestamp, and metadata per item across multi-item admission", () => {
      const itemA = makeItem("fb-granular-A", {
        timestamp: "2026-09-01T10:00:00.000Z",
        metadata: { origin: "probe-1" },
      });
      const itemB = makeItem("fb-granular-B", {
        timestamp: "2026-09-01T10:01:00.000Z",
        metadata: { origin: "probe-2" },
      });

      appendFeedbackItem(itemA, queuePath);
      appendFeedbackItem(itemB, queuePath);

      const items = readFeedbackQueue(queuePath);
      expect(items.length).toBe(2);
      expect(items[0]?.id).toBe("fb-granular-A");
      expect(items[0]?.metadata?.["origin"]).toBe("probe-1");
      expect(items[1]?.id).toBe("fb-granular-B");
      expect(items[1]?.metadata?.["origin"]).toBe("probe-2");
    });
  });

  describe("Dispatch Audit Multi-Mode Resolution", () => {
    it("resolves tasks by dispatched_task_id, feedback_id, and batched_feedback_ids", () => {
      // 1. Direct match by dispatched_task_id
      appendFeedbackItem(
        makeItem("fb-m1", {
          status: "ADMITTED",
          metadata: { dispatched_task_id: "task-direct-1" },
        }),
        queuePath,
      );

      // 2. Reverse match by task metadata.feedback_id
      appendFeedbackItem(makeItem("fb-m2", { status: "ADMITTED" }), queuePath);

      // 3. Array match by task metadata.batched_feedback_ids
      appendFeedbackItem(makeItem("fb-m3", { status: "ADMITTED" }), queuePath);

      // Populate task queue supporting all 3 resolution modes
      writeTaskQueue([
        { id: "task-direct-1", status: "RUNNING" },
        { id: "task-rev-2", status: "PENDING", metadata: { feedback_id: "fb-m2" } },
        { id: "task-batch-3", status: "RUNNING", metadata: { batched_feedback_ids: "fb-m3" } },
      ]);

      const report = auditAdmissionDispatchIntegrity({
        feedbackPath: queuePath,
        taskQueuePath,
      });

      expect(report.is_compliant).toBe(true);
      expect(report.admitted_feedback_count).toBe(3);
      expect(report.active_dispatched_feedback_count).toBe(3);
      expect(report.paused_admitted_feedback_count).toBe(0);
      expect(report.violations).toEqual([]);
    });

    it("detects violations when admitted feedback items lack enqueued tasks", () => {
      appendFeedbackItem(
        makeItem("fb-unlinked", {
          status: "ADMITTED",
          title: "Unlinked Task Issue",
          metadata: { dispatched_task_id: "task-missing-404" },
        }),
        queuePath,
      );

      writeTaskQueue([]); // Empty task queue

      const report = auditAdmissionDispatchIntegrity({
        feedbackPath: queuePath,
        taskQueuePath,
      });

      expect(report.is_compliant).toBe(false);
      expect(report.paused_admitted_feedback_count).toBe(1);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]).toContain("is paused without an enqueued/dispatched task node");
    });
  });

  describe("Dual Reconciliation Modes", () => {
    it("reconciles paused admitted feedbacks by resetting status to PENDING", () => {
      appendFeedbackItem(
        makeItem("fb-rec-pend", {
          status: "ADMITTED",
          metadata: { dispatched_task_id: "task-absent" },
        }),
        queuePath,
      );

      const reconciled = reconcilePausedAdmittedFeedbacks({
        feedbackPath: queuePath,
        taskQueuePath,
        resetToPending: true,
      });

      expect(reconciled.reconciled_count).toBe(1);
      expect(reconciled.remediated_feedbacks[0]?.status).toBe("PENDING");

      const queue = readFeedbackQueue(queuePath);
      expect(queue[0]?.status).toBe("PENDING");
    });

    it("reconciles paused admitted feedbacks by keeping ADMITTED and clearing processed_at", () => {
      appendFeedbackItem(
        makeItem("fb-rec-keep", {
          status: "ADMITTED",
          processed_at: "2026-09-01T10:00:00.000Z",
          metadata: { dispatched_task_id: "task-absent-2" },
        }),
        queuePath,
      );

      const reconciled = reconcilePausedAdmittedFeedbacks({
        feedbackPath: queuePath,
        taskQueuePath,
        resetToPending: false,
      });

      expect(reconciled.reconciled_count).toBe(1);
      expect(reconciled.remediated_feedbacks[0]?.status).toBe("ADMITTED");
      expect(reconciled.remediated_feedbacks[0]?.processed_at).toBeNull();

      const queue = readFeedbackQueue(queuePath);
      expect(queue[0]?.status).toBe("ADMITTED");
      expect(queue[0]?.processed_at).toBeNull();
    });
  });
});
