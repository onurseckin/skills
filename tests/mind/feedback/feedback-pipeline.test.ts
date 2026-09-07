import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  admitAndDispatchFeedbackAtomically,
  auditAdmissionDispatchIntegrity,
  reconcilePausedAdmittedFeedbacks,
} from "../../../olt/scripts/src/mind/feedback/queue/metrics.ts";
import {
  backpropagateFeedbackResolution,
  compareFeedbackPriority,
  drainPendingFeedbacks,
  getFeedbackStats,
  sortFeedbackByPriority,
} from "../../../olt/scripts/src/mind/feedback/queue/filter.ts";
import { appendFeedbackItem } from "../../../olt/scripts/src/mind/feedback/queue/ops.ts";
import { readFeedbackQueue } from "../../../olt/scripts/src/mind/feedback/queue/ingest.ts";
import type {
  BackpropagationRecord,
  FeedbackItem,
  FeedbackPriority,
} from "../../../olt/scripts/src/mind/feedback/queue/types.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Mind Feedback Pipeline Suite", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  const queuePath = "/virtual/mind/feedback/pipeline-queue.jsonl";
  const taskQueuePath = "/virtual/mind/feedback/tasks.jsonl";

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
    vfs.mkdirSync("/virtual/mind/feedback", { recursive: true });
  });

  afterEach(() => {
    session.cleanup();
  });

  function makeItem(
    id: string,
    priority: FeedbackPriority,
    timestamp: string,
    overrides: Partial<FeedbackItem> = {},
  ): FeedbackItem {
    return {
      id,
      timestamp,
      priority,
      category: "ENGINE",
      status: "PENDING",
      title: `Task ${id}`,
      content: `Content for ${id}`,
      ...overrides,
    };
  }

  describe("Priority Hierarchy & FIFO Tie Resolution", () => {
    it("orders all 5 feedback priorities strictly according to hierarchy", () => {
      const items: FeedbackItem[] = [
        makeItem("fb-low", "LOW", "2026-09-01T10:00:00.000Z"),
        makeItem("fb-crit", "CRITICAL_USER_FEEDBACK", "2026-09-01T10:00:00.000Z"),
        makeItem("fb-arch", "HIGH_ARCHITECTURAL_FEATURE", "2026-09-01T10:00:00.000Z"),
        makeItem("fb-norm", "NORMAL", "2026-09-01T10:00:00.000Z"),
        makeItem("fb-dir", "USER_DIRECTIVE", "2026-09-01T10:00:00.000Z"),
      ];

      const sorted = sortFeedbackByPriority(items);
      const sortedIds = sorted.map((i) => i.id);

      expect(sortedIds).toEqual(["fb-crit", "fb-arch", "fb-dir", "fb-norm", "fb-low"]);
    });

    it("resolves identical priority items using deterministic FIFO timestamp order", () => {
      const items: FeedbackItem[] = [
        makeItem("fb-later", "CRITICAL_USER_FEEDBACK", "2026-09-01T12:00:00.000Z"),
        makeItem("fb-earliest", "CRITICAL_USER_FEEDBACK", "2026-09-01T08:00:00.000Z"),
        makeItem("fb-middle", "CRITICAL_USER_FEEDBACK", "2026-09-01T10:00:00.000Z"),
      ];

      const sorted = sortFeedbackByPriority(items);
      expect(sorted.map((i) => i.id)).toEqual(["fb-earliest", "fb-middle", "fb-later"]);
    });

    it("compares priority enum strings directly", () => {
      expect(compareFeedbackPriority("CRITICAL_USER_FEEDBACK", "LOW")).toBeLessThan(0);
      expect(compareFeedbackPriority("NORMAL", "HIGH_ARCHITECTURAL_FEATURE")).toBeGreaterThan(0);
      expect(compareFeedbackPriority("NORMAL", "NORMAL")).toBe(0);
    });
  });

  describe("Atomic Admission & Task Dispatching", () => {
    it("admits feedback and dispatches task atomically with metadata linkage", () => {
      const initial = appendFeedbackItem(
        makeItem("fb-admit-1", "HIGH_ARCHITECTURAL_FEATURE", "2026-09-01T10:00:00.000Z"),
        queuePath,
      );
      expect(initial.status).toBe("PENDING");

      const result = admitAndDispatchFeedbackAtomically(
        "fb-admit-1",
        (_item) => ({
          taskId: "task-dispatched-101",
          autoEnqueued: true,
          metadata: { planner: "dynamic-graph" },
        }),
        queuePath,
      );

      expect(result.feedback_item.id).toBe("fb-admit-1");
      expect(result.feedback_item.status).toBe("ADMITTED");
      expect(result.dispatched_task_id).toBe("task-dispatched-101");
      expect(result.feedback_item.metadata?.["dispatched_task_id"]).toBe("task-dispatched-101");
      expect(result.feedback_item.metadata?.["planner"]).toBe("dynamic-graph");

      const queueState = readFeedbackQueue(queuePath);
      expect(queueState[0]?.status).toBe("ADMITTED");
    });

    it("throws INVALID_STATE when attempting to admit non-existent feedback ID", () => {
      expect(() =>
        admitAndDispatchFeedbackAtomically(
          "fb-non-existent",
          () => ({ taskId: "task-x" }),
          queuePath,
        ),
      ).toThrow(HarnessError);
    });

    it("throws INTEGRITY error when dispatcher returns missing or blank taskId", () => {
      appendFeedbackItem(
        makeItem("fb-blank-task", "NORMAL", "2026-09-01T10:00:00.000Z"),
        queuePath,
      );

      expect(() =>
        admitAndDispatchFeedbackAtomically("fb-blank-task", () => ({ taskId: "   " }), queuePath),
      ).toThrow(HarnessError);
    });
  });

  describe("Lifecycle Drainage, Backpropagation & Integrity Auditing", () => {
    it("drains pending feedbacks respecting category, limit, and custom predicates", () => {
      appendFeedbackItem(
        makeItem("fb-p1", "NORMAL", "2026-09-01T09:00:00.000Z", { category: "ENGINE" }),
        queuePath,
      );
      appendFeedbackItem(
        makeItem("fb-p2", "NORMAL", "2026-09-01T09:30:00.000Z", { category: "ENGINE" }),
        queuePath,
      );
      appendFeedbackItem(
        makeItem("fb-p3", "NORMAL", "2026-09-01T10:00:00.000Z", { category: "VALIDATION" }),
        queuePath,
      );

      const drained = drainPendingFeedbacks({ category: "ENGINE", limit: 1 }, queuePath);

      expect(drained.length).toBe(1);
      expect(drained[0]?.id).toBe("fb-p1");
      expect(drained[0]?.status).toBe("PROCESSED");
      expect(drained[0]?.processed_at).toBeDefined();

      const remaining = readFeedbackQueue(queuePath);
      const stats = getFeedbackStats(remaining);
      expect(stats.processed).toBe(1);
      expect(stats.pending).toBe(2);
    });

    it("backpropagates task resolution to seal feedback items as COMPLETED", () => {
      appendFeedbackItem(
        makeItem("fb-resolve-1", "CRITICAL_USER_FEEDBACK", "2026-09-01T10:00:00.000Z", {
          candidate_id: "cand-777",
        }),
        queuePath,
      );

      const records: BackpropagationRecord[] = [
        {
          id: "cand-777",
          commit_sha: "c1a2b3d",
          proof_summary: "Resolved bug via VirtualMemoryFS refactor",
          test_path: "tests/kernel.test.ts",
          assertions: 12,
          runtime_ms: 4,
          completed_at: "2026-09-01T11:00:00.000Z",
        },
      ];

      const resolved = backpropagateFeedbackResolution(records, queuePath);
      expect(resolved.length).toBe(1);
      expect(resolved[0]?.id).toBe("fb-resolve-1");
      expect(resolved[0]?.status).toBe("COMPLETED");
      expect(resolved[0]?.commit_sha).toBe("c1a2b3d");
      expect(resolved[0]?.resolution?.task_id).toBe("cand-777");
    });

    it("audits admission-dispatch integrity and detects orphaned tasks", () => {
      const admittedItem = makeItem(
        "fb-orphan",
        "HIGH_ARCHITECTURAL_FEATURE",
        "2026-09-01T10:00:00.000Z",
        {
          status: "ADMITTED",
          metadata: { dispatched_task_id: "task-missing-999" },
        },
      );
      appendFeedbackItem(admittedItem, queuePath);

      const auditFail = auditAdmissionDispatchIntegrity({
        feedbackPath: queuePath,
        taskQueuePath,
      });
      expect(auditFail.is_compliant).toBe(false);
      expect(auditFail.paused_admitted_feedback_count).toBe(1);
      expect(auditFail.violations.length).toBeGreaterThan(0);

      const reconciled = reconcilePausedAdmittedFeedbacks({
        feedbackPath: queuePath,
        taskQueuePath,
        resetToPending: true,
      });
      expect(reconciled.reconciled_count).toBe(1);
      expect(reconciled.remediated_feedbacks[0]?.status).toBe("PENDING");

      const updatedQueue = readFeedbackQueue(queuePath);
      expect(updatedQueue[0]?.status).toBe("PENDING");
    });
  });
});
