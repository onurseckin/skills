import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  backpropagateFeedbackResolution,
  drainPendingFeedbacks,
} from "../../../../olt/scripts/src/mind/feedback/queue/filter.ts";
import { writeFeedbackQueue } from "../../../../olt/scripts/src/mind/feedback/queue/admission.ts";
import { readFeedbackQueue } from "../../../../olt/scripts/src/mind/feedback/queue/ingest.ts";
import type {
  BackpropagationRecord,
  FeedbackItem,
  FeedbackPriority,
} from "../../../../olt/scripts/src/mind/feedback/queue/types.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Mind Feedback Queue Drainage Edge Cases Suite", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  const testDir = "/virtual/mind/feedback/queue";
  const queuePath = `${testDir}/drain-edge.jsonl`;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    vfs.mkdirSync(testDir, { recursive: true });
    session = createVirtualFSSession(vfs);
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
      title: `Item ${id}`,
      content: `Content for ${id}`,
      ...overrides,
    };
  }

  describe("Boundary & Edge Drainage Scenarios", () => {
    it("returns empty array safely when draining an empty queue", () => {
      const drained = drainPendingFeedbacks({}, queuePath);
      expect(drained).toEqual([]);
      expect(readFeedbackQueue(queuePath)).toEqual([]);
    });

    it("returns empty array without mutating queue when zero items are PENDING", () => {
      const items: FeedbackItem[] = [
        makeItem("fb-done-1", "NORMAL", "2026-09-01T10:00:00.000Z", { status: "COMPLETED" }),
        makeItem("fb-admitted-1", "NORMAL", "2026-09-01T10:05:00.000Z", { status: "ADMITTED" }),
      ];
      writeFeedbackQueue(items, queuePath);

      const drained = drainPendingFeedbacks({}, queuePath);
      expect(drained).toEqual([]);

      const after = readFeedbackQueue(queuePath);
      expect(after.map((i) => i.status)).toEqual(["COMPLETED", "ADMITTED"]);
    });

    it("drains zero items and leaves queue intact when limit is 0", () => {
      writeFeedbackQueue(
        [makeItem("fb-pending-1", "NORMAL", "2026-09-01T10:00:00.000Z")],
        queuePath,
      );

      const drained = drainPendingFeedbacks({ limit: 0 }, queuePath);
      expect(drained).toEqual([]);

      const queue = readFeedbackQueue(queuePath);
      expect(queue[0]?.status).toBe("PENDING");
    });

    it("drains all available items when limit exceeds total pending count", () => {
      writeFeedbackQueue(
        [
          makeItem("fb-ex-1", "NORMAL", "2026-09-01T10:00:00.000Z"),
          makeItem("fb-ex-2", "NORMAL", "2026-09-01T10:01:00.000Z"),
        ],
        queuePath,
      );

      const drained = drainPendingFeedbacks({ limit: 999 }, queuePath);
      expect(drained.length).toBe(2);
      expect(drained.map((d) => d.id)).toEqual(["fb-ex-1", "fb-ex-2"]);

      const queue = readFeedbackQueue(queuePath);
      expect(queue.every((i) => i.status === "PROCESSED")).toBe(true);
    });
  });

  describe("Priority Ranking & FIFO Preservation", () => {
    it("preserves priority hierarchy and FIFO tie resolution during drainage", () => {
      const items: FeedbackItem[] = [
        makeItem("fb-low", "LOW", "2026-09-01T10:00:00.000Z"),
        makeItem("fb-crit-late", "CRITICAL_USER_FEEDBACK", "2026-09-01T10:05:00.000Z"),
        makeItem("fb-crit-early", "CRITICAL_USER_FEEDBACK", "2026-09-01T10:00:00.000Z"),
        makeItem("fb-norm", "NORMAL", "2026-09-01T10:00:00.000Z"),
      ];
      // writeFeedbackQueue automatically sorts items by priority upon write
      writeFeedbackQueue(items, queuePath);

      const drained = drainPendingFeedbacks({}, queuePath);
      const drainedIds = drained.map((d) => d.id);

      expect(drainedIds).toEqual(["fb-crit-early", "fb-crit-late", "fb-norm", "fb-low"]);
    });
  });

  describe("Idempotency & Lifecycle Backpropagation", () => {
    it("is completely idempotent across consecutive drainage invocations", () => {
      writeFeedbackQueue([makeItem("fb-idem", "NORMAL", "2026-09-01T10:00:00.000Z")], queuePath);

      const firstDrain = drainPendingFeedbacks({}, queuePath);
      expect(firstDrain.length).toBe(1);

      const secondDrain = drainPendingFeedbacks({}, queuePath);
      expect(secondDrain).toEqual([]);

      const thirdDrain = drainPendingFeedbacks({}, queuePath);
      expect(thirdDrain).toEqual([]);
    });

    it("allows drained PROCESSED items to resolve via backpropagation", () => {
      writeFeedbackQueue(
        [
          makeItem("fb-drain-backprop", "HIGH_ARCHITECTURAL_FEATURE", "2026-09-01T10:00:00.000Z", {
            candidate_id: "cand-drain-resolve",
          }),
        ],
        queuePath,
      );

      // 1. Drain item to PROCESSED
      const drained = drainPendingFeedbacks({}, queuePath);
      expect(drained[0]?.status).toBe("PROCESSED");

      // 2. Backpropagate resolution proof
      const proofRecords: BackpropagationRecord[] = [
        {
          id: "cand-drain-resolve",
          commit_sha: "789abcd",
          proof_summary: "Resolved after drainage pipeline completion",
          test_path: "tests/mind/feedback/queue/queue-drainage.test.ts",
          assertions: 6,
          runtime_ms: 2,
        },
      ];

      const resolved = backpropagateFeedbackResolution(proofRecords, queuePath);
      expect(resolved.length).toBe(1);
      expect(resolved[0]?.status).toBe("COMPLETED");
      expect(resolved[0]?.resolution?.task_id).toBe("cand-drain-resolve");
      expect(resolved[0]?.commit_sha).toBe("789abcd");

      const finalQueue = readFeedbackQueue(queuePath);
      expect(finalQueue[0]?.status).toBe("COMPLETED");
    });
  });
});
