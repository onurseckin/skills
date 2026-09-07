import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  admitFeedbackToQueue,
  appendFeedbackItem,
} from "../../../../../olt/scripts/src/mind/feedback/queue/ops.ts";
import { admitAndDispatchFeedbackAtomically } from "../../../../../olt/scripts/src/mind/feedback/queue/metrics.ts";
import { readFeedbackQueue } from "../../../../../olt/scripts/src/mind/feedback/queue/ingest.ts";
import type { FeedbackItem } from "../../../../../olt/scripts/src/mind/feedback/queue/types.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Mind Feedback Admission Gates Suite", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  const testDir = "/virtual/mind/feedback/admission";
  const queuePath = `${testDir}/gates.jsonl`;

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

  describe("Direct Admission Gates (String ID vs Object Payload)", () => {
    it("admits existing pending item by string ID and populates processed_at", () => {
      appendFeedbackItem(makeItem("fb-gate-1"), queuePath);

      const admitted = admitFeedbackToQueue("fb-gate-1", queuePath);
      expect(admitted.id).toBe("fb-gate-1");
      expect(admitted.status).toBe("ADMITTED");
      expect(admitted.processed_at).toBeDefined();

      const queue = readFeedbackQueue(queuePath);
      expect(queue[0]?.status).toBe("ADMITTED");
      expect(queue[0]?.processed_at).toBe(admitted.processed_at);
    });

    it("preserves initial processed_at timestamp upon re-admission idempotency", () => {
      appendFeedbackItem(makeItem("fb-gate-idem"), queuePath);

      const firstAdmission = admitFeedbackToQueue("fb-gate-idem", queuePath);
      const reAdmission = admitFeedbackToQueue("fb-gate-idem", queuePath);

      expect(reAdmission.processed_at).toBe(firstAdmission.processed_at);
      expect(reAdmission.status).toBe("ADMITTED");
    });

    it("admits existing item supplied as object with updated attributes", () => {
      appendFeedbackItem(makeItem("fb-gate-obj", { title: "Original Title" }), queuePath);

      const updatedAdmitted = admitFeedbackToQueue(
        makeItem("fb-gate-obj", {
          title: "Mutated Title",
          content: "Mutated Content",
          status: "ADMITTED",
        }),
        queuePath,
      );

      expect(updatedAdmitted.id).toBe("fb-gate-obj");
      expect(updatedAdmitted.title).toBe("Mutated Title");
      expect(updatedAdmitted.content).toBe("Mutated Content");
      expect(updatedAdmitted.status).toBe("ADMITTED");

      const queue = readFeedbackQueue(queuePath);
      expect(queue[0]?.title).toBe("Mutated Title");
      expect(queue[0]?.status).toBe("ADMITTED");
    });

    it("admits brand new item supplied as object directly into the queue", () => {
      const admittedNew = admitFeedbackToQueue(
        makeItem("fb-brand-new", { title: "Brand New Direct Admission", status: "ADMITTED" }),
        queuePath,
      );

      expect(admittedNew.id).toBe("fb-brand-new");
      expect(admittedNew.status).toBe("ADMITTED");

      const queue = readFeedbackQueue(queuePath);
      expect(queue.length).toBe(1);
      expect(queue[0]?.id).toBe("fb-brand-new");
      expect(queue[0]?.status).toBe("ADMITTED");
    });
  });

  describe("Atomic Admission & Task Dispatch Linkage", () => {
    it("atomically admits feedback item and links dispatched task metadata", () => {
      appendFeedbackItem(
        makeItem("fb-dispatch-1", { priority: "HIGH_ARCHITECTURAL_FEATURE" }),
        queuePath,
      );

      const result = admitAndDispatchFeedbackAtomically(
        "fb-dispatch-1",
        (_item) => ({
          taskId: "task-linked-9001",
          autoEnqueued: true,
          metadata: { router: "admission-gate" },
        }),
        queuePath,
      );

      expect(result.dispatched_task_id).toBe("task-linked-9001");
      expect(result.auto_enqueued).toBe(true);
      expect(result.feedback_item.status).toBe("ADMITTED");
      expect(result.feedback_item.metadata?.["dispatched_task_id"]).toBe("task-linked-9001");
      expect(result.feedback_item.metadata?.["router"]).toBe("admission-gate");

      const queue = readFeedbackQueue(queuePath);
      expect(queue[0]?.metadata?.["dispatched_task_id"]).toBe("task-linked-9001");
      expect(queue[0]?.status).toBe("ADMITTED");
    });
  });
});
