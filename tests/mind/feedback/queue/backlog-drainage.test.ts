import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  drainPendingFeedbacks,
  getFeedbackStats,
} from "../../../../olt/scripts/src/mind/feedback/queue/filter.ts";
import { writeFeedbackQueue } from "../../../../olt/scripts/src/mind/feedback/queue/admission.ts";
import { readFeedbackQueue } from "../../../../olt/scripts/src/mind/feedback/queue/ingest.ts";
import type {
  FeedbackCategory,
  FeedbackItem,
} from "../../../../olt/scripts/src/mind/feedback/queue/types.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Mind Feedback Backlog Drainage Suite", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  const testDir = "/virtual/mind/feedback/queue";
  const queuePath = `${testDir}/drain-backlog.jsonl`;

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
    category: FeedbackCategory,
    timestamp: string,
    overrides: Partial<FeedbackItem> = {},
  ): FeedbackItem {
    return {
      id,
      timestamp,
      priority: "NORMAL",
      category,
      status: "PENDING",
      title: `Item ${id}`,
      content: `Content for ${id}`,
      ...overrides,
    };
  }

  describe("Category Isolation & State Transitions", () => {
    it("drains only targeted category while leaving other categories strictly PENDING", () => {
      const items: FeedbackItem[] = [
        makeItem("fb-eng-1", "ENGINE", "2026-09-01T10:00:00.000Z"),
        makeItem("fb-doc-1", "DOCUMENTATION", "2026-09-01T10:05:00.000Z"),
        makeItem("fb-eng-2", "ENGINE", "2026-09-01T10:10:00.000Z"),
        makeItem("fb-audit-1", "AUDITING", "2026-09-01T10:15:00.000Z"),
        makeItem("fb-contr-1", "AGENT_CONTRACTS", "2026-09-01T10:20:00.000Z"),
      ];

      writeFeedbackQueue(items, queuePath);

      // Drain only category ENGINE
      const drained = drainPendingFeedbacks({ category: "ENGINE" }, queuePath);
      expect(drained.length).toBe(2);
      expect(drained.map((d) => d.id)).toEqual(["fb-eng-1", "fb-eng-2"]);

      for (const item of drained) {
        expect(item.status).toBe("PROCESSED");
        expect(item.processed_at).toBeDefined();
      }

      // Check remaining queue state
      const queueAfter = readFeedbackQueue(queuePath);
      const remainingPending = queueAfter.filter((i) => i.status === "PENDING");
      expect(remainingPending.length).toBe(3);
      expect(remainingPending.map((i) => i.id)).toEqual(["fb-doc-1", "fb-audit-1", "fb-contr-1"]);

      for (const pending of remainingPending) {
        expect(pending.processed_at).toBeUndefined();
      }
    });
  });

  describe("Bounded Limits & Custom Status (markAs)", () => {
    it("drains exactly limit count in priority order and preserves excess items", () => {
      const items: FeedbackItem[] = [
        makeItem("fb-1", "ENGINE", "2026-09-01T10:00:00.000Z"),
        makeItem("fb-2", "ENGINE", "2026-09-01T10:01:00.000Z"),
        makeItem("fb-3", "ENGINE", "2026-09-01T10:02:00.000Z"),
        makeItem("fb-4", "ENGINE", "2026-09-01T10:03:00.000Z"),
        makeItem("fb-5", "ENGINE", "2026-09-01T10:04:00.000Z"),
      ];

      writeFeedbackQueue(items, queuePath);

      const drained = drainPendingFeedbacks({ limit: 2 }, queuePath);
      expect(drained.length).toBe(2);
      expect(drained.map((d) => d.id)).toEqual(["fb-1", "fb-2"]);

      const remaining = readFeedbackQueue(queuePath);
      const pending = remaining.filter((i) => i.status === "PENDING");
      expect(pending.length).toBe(3);
      expect(pending.map((p) => p.id)).toEqual(["fb-3", "fb-4", "fb-5"]);
    });

    it("marks drained items with specified custom status (markAs: ADMITTED)", () => {
      writeFeedbackQueue(
        [makeItem("fb-admit-target", "GENERAL", "2026-09-01T10:00:00.000Z")],
        queuePath,
      );

      const drained = drainPendingFeedbacks({ markAs: "ADMITTED" }, queuePath);
      expect(drained.length).toBe(1);
      expect(drained[0]?.status).toBe("ADMITTED");

      const queue = readFeedbackQueue(queuePath);
      expect(queue[0]?.status).toBe("ADMITTED");
    });
  });

  describe("Queue Statistics Tracking", () => {
    it("tracks feedback statistics accurately across multi-stage drainage", () => {
      const items: FeedbackItem[] = [
        makeItem("fb-s1", "ENGINE", "2026-09-01T10:00:00.000Z"),
        makeItem("fb-s2", "ENGINE", "2026-09-01T10:01:00.000Z"),
        makeItem("fb-s3", "ENGINE", "2026-09-01T10:02:00.000Z"),
      ];

      writeFeedbackQueue(items, queuePath);

      // 1. Initial stats
      let stats = getFeedbackStats(readFeedbackQueue(queuePath));
      expect(stats.total).toBe(3);
      expect(stats.pending).toBe(3);
      expect(stats.processed).toBe(0);

      // 2. Partial drain
      drainPendingFeedbacks({ limit: 1 }, queuePath);
      stats = getFeedbackStats(readFeedbackQueue(queuePath));
      expect(stats.total).toBe(3);
      expect(stats.pending).toBe(2);
      expect(stats.processed).toBe(1);

      // 3. Complete drain
      drainPendingFeedbacks({}, queuePath);
      stats = getFeedbackStats(readFeedbackQueue(queuePath));
      expect(stats.total).toBe(3);
      expect(stats.pending).toBe(0);
      expect(stats.processed).toBe(3);
    });
  });
});
