import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  appendFeedbackItem,
  backpropagateFeedbackResolution,
  compareFeedbackPriority,
  drainPendingFeedbacks,
  getFeedbackStats,
  normalizeFeedbackCategory,
  normalizeFeedbackPriority,
  normalizeFeedbackStatus,
  sortFeedbackByPriority,
  type BackpropagationRecord,
  type FeedbackItem,
} from "../../../../../olt/scripts/src/mind/feedback/index.ts";
import { VirtualMemoryFS } from "../../../../../olt/scripts/src/testing/virtual-fs/memory-fs.ts";
import {
  createVirtualFSSession,
  type VirtualFSSession,
} from "../../../../../olt/scripts/src/testing/virtual-fs/spies.ts";

describe("Mind Feedback Memory Core Operations (In-Memory)", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  const queuePath = "/virtual/feedback/backlog.jsonl";

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    vfs.mkdirSync("/virtual/feedback", { recursive: true });
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    session.cleanup();
  });

  describe("compareFeedbackPriority and sortFeedbackByPriority", () => {
    it("orders priorities strictly from critical to low with timestamp tie-breakers", () => {
      const itemLow: FeedbackItem = {
        id: "fb-low",
        priority: "LOW",
        status: "PENDING",
        category: "GENERAL",
        title: "Low priority fix",
        content: "Details",
        timestamp: "2026-09-01T00:00:00.000Z",
      };

      const itemHigh: FeedbackItem = {
        id: "fb-high",
        priority: "HIGH_ARCHITECTURAL_FEATURE",
        status: "PENDING",
        category: "ARCHITECTURE",
        title: "High feature",
        content: "Details",
        timestamp: "2026-09-02T00:00:00.000Z",
      };

      const itemCritical: FeedbackItem = {
        id: "fb-crit",
        priority: "CRITICAL_USER_FEEDBACK",
        status: "PENDING",
        category: "CORE_ENGINE",
        title: "Critical feedback",
        content: "Details",
        timestamp: "2026-09-03T00:00:00.000Z",
      };

      const itemCritOlder: FeedbackItem = {
        id: "fb-crit-older",
        priority: "CRITICAL_USER_FEEDBACK",
        status: "PENDING",
        category: "CORE_ENGINE",
        title: "Critical older feedback",
        content: "Details",
        timestamp: "2026-09-01T00:00:00.000Z",
      };

      expect(compareFeedbackPriority("CRITICAL_USER_FEEDBACK", "LOW")).toBeLessThan(0);
      expect(compareFeedbackPriority("LOW", "HIGH_ARCHITECTURAL_FEATURE")).toBeGreaterThan(0);
      expect(compareFeedbackPriority("NORMAL", "NORMAL")).toBe(0);

      // Timestamp tie-breaking for equal priorities
      expect(compareFeedbackPriority(itemCritOlder, itemCritical)).toBeLessThan(0);

      const sorted = sortFeedbackByPriority([itemLow, itemCritical, itemHigh, itemCritOlder]);
      expect(sorted.map((i) => i.id)).toEqual(["fb-crit-older", "fb-crit", "fb-high", "fb-low"]);
    });
  });

  describe("getFeedbackStats", () => {
    it("computes accurate aggregate status metrics across feedback queues", () => {
      const items: FeedbackItem[] = [
        {
          id: "1",
          status: "PENDING",
          priority: "NORMAL",
          category: "GENERAL",
          title: "t1",
          content: "c1",
          timestamp: "2026-09-01T00:00:00.000Z",
        },
        {
          id: "2",
          status: "PENDING",
          priority: "LOW",
          category: "GENERAL",
          title: "t2",
          content: "c2",
          timestamp: "2026-09-01T00:00:00.000Z",
        },
        {
          id: "3",
          status: "ADMITTED",
          priority: "NORMAL",
          category: "GENERAL",
          title: "t3",
          content: "c3",
          timestamp: "2026-09-01T00:00:00.000Z",
        },
        {
          id: "4",
          status: "DECLINED",
          priority: "NORMAL",
          category: "GENERAL",
          title: "t4",
          content: "c4",
          timestamp: "2026-09-01T00:00:00.000Z",
        },
        {
          id: "5",
          status: "PROCESSED",
          priority: "NORMAL",
          category: "GENERAL",
          title: "t5",
          content: "c5",
          timestamp: "2026-09-01T00:00:00.000Z",
        },
        {
          id: "6",
          status: "COMPLETED",
          priority: "NORMAL",
          category: "GENERAL",
          title: "t6",
          content: "c6",
          timestamp: "2026-09-01T00:00:00.000Z",
        },
      ];

      const stats = getFeedbackStats(items);
      expect(stats.total).toBe(6);
      expect(stats.pending).toBe(2);
      expect(stats.admitted).toBe(1);
      expect(stats.declined).toBe(1);
      expect(stats.processed).toBe(1);
      expect(stats.completed).toBe(1);

      // Empty feedback items return zero counts
      expect(getFeedbackStats([])).toEqual({
        total: 0,
        pending: 0,
        admitted: 0,
        declined: 0,
        processed: 0,
        completed: 0,
      });
    });
  });

  describe("drainPendingFeedbacks and appendFeedbackItem", () => {
    it("manages atomic queue append and filtered pending drainage in virtual memory", () => {
      appendFeedbackItem(
        {
          id: "item-1",
          priority: "NORMAL",
          status: "PENDING",
          category: "DOCUMENTATION",
          title: "Update API guide",
          content: "Clarify zero-disk unit testing",
        },
        queuePath,
      );

      appendFeedbackItem(
        {
          id: "item-2",
          priority: "HIGH_ARCHITECTURAL_FEATURE",
          status: "PENDING",
          category: "ARCHITECTURE",
          title: "Decouple IO",
          content: "Implement in-memory mocks",
        },
        queuePath,
      );

      // Duplicate rejection invariant
      expect(() =>
        appendFeedbackItem(
          {
            id: "item-1",
            priority: "NORMAL",
            status: "PENDING",
            category: "DOCUMENTATION",
            title: "Duplicate",
            content: "Should fail",
          },
          queuePath,
        ),
      ).toThrow("already exists");

      // Filtered drain by category
      const drainedDocs = drainPendingFeedbacks(
        { category: "DOCUMENTATION", markAs: "PROCESSED" },
        queuePath,
      );
      expect(drainedDocs.length).toBe(1);
      expect(drainedDocs[0]?.id).toBe("item-1");
      expect(drainedDocs[0]?.status).toBe("PROCESSED");

      // Draining with limit
      const drainedArch = drainPendingFeedbacks({ limit: 1 }, queuePath);
      expect(drainedArch.length).toBe(1);
      expect(drainedArch[0]?.id).toBe("item-2");

      // Second drain yields empty
      expect(drainPendingFeedbacks({}, queuePath)).toEqual([]);
    });
  });

  describe("backpropagateFeedbackResolution", () => {
    it("updates feedback item status and stamps verified resolution proof", () => {
      appendFeedbackItem(
        {
          id: "fb-to-resolve",
          candidate_id: "cand-123",
          priority: "NORMAL",
          status: "PENDING",
          category: "REPAIR",
          title: "Fix flake",
          content: "Eliminate race in test",
        },
        queuePath,
      );

      const record: BackpropagationRecord = {
        id: "cand-123",
        commit_sha: "abc1234",
        proof_summary: "Race resolved via in-memory locks",
        test_path: "tests/mind/feedback/memory/core/memory.test.ts",
        assertions: 10,
        runtime_ms: 1.5,
        completed_at: "2026-09-06T12:00:00.000Z",
      };

      const updated = backpropagateFeedbackResolution([record], queuePath);
      expect(updated.length).toBe(1);
      expect(updated[0]?.id).toBe("fb-to-resolve");
      expect(updated[0]?.status).toBe("COMPLETED");
      expect(updated[0]?.commit_sha).toBe("abc1234");
      expect(updated[0]?.resolution?.task_id).toBe("cand-123");
      expect(updated[0]?.resolution?.test_path).toBe(
        "tests/mind/feedback/memory/core/memory.test.ts",
      );

      // Empty records return empty array immediately
      expect(backpropagateFeedbackResolution([], queuePath)).toEqual([]);

      // Unmatched record leaves items untouched and returns empty result
      const unmatched: BackpropagationRecord = { id: "nonexistent-task" };
      expect(backpropagateFeedbackResolution([unmatched], queuePath)).toEqual([]);
    });
  });

  describe("normalizer helpers", () => {
    it("normalizes feedback category, priority, and status strings and rejects invalid inputs", () => {
      expect(normalizeFeedbackPriority("critical")).toBe("CRITICAL_USER_FEEDBACK");
      expect(normalizeFeedbackPriority("high")).toBe("HIGH_ARCHITECTURAL_FEATURE");
      expect(normalizeFeedbackPriority("directive")).toBe("USER_DIRECTIVE");
      expect(normalizeFeedbackPriority("medium")).toBe("NORMAL");
      expect(normalizeFeedbackPriority("low")).toBe("LOW");
      expect(() => normalizeFeedbackPriority("invalid-prio")).toThrow("valid priority");

      expect(normalizeFeedbackCategory("DOCUMENTATION")).toBe("DOCUMENTATION");
      expect(normalizeFeedbackCategory("ENGINE")).toBe("ENGINE");
      expect(normalizeFeedbackCategory("ARCHITECTURE")).toBe("ARCHITECTURE");
      expect(() => normalizeFeedbackCategory("unrecognized-category")).toThrow("valid category");

      expect(normalizeFeedbackStatus("pending")).toBe("PENDING");
      expect(normalizeFeedbackStatus("admitted")).toBe("ADMITTED");
      expect(normalizeFeedbackStatus("completed")).toBe("COMPLETED");
      expect(normalizeFeedbackStatus("planned")).toBe("ADMITTED");
      expect(() => normalizeFeedbackStatus("unknown-status")).toThrow("valid status");
    });
  });
});
