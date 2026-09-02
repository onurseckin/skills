import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  backpropagateFeedbackResolution,
  compareFeedbackPriority,
  drainPendingFeedbacks,
  getFeedbackStats,
  sortFeedbackByPriority,
} from "../../../olt/scripts/src/mind/feedback/queue/filter.ts";
import type {
  BackpropagationRecord,
  FeedbackItem,
} from "../../../olt/scripts/src/mind/feedback/queue/types.ts";
import { writeFeedbackQueue } from "../../../olt/scripts/src/mind/feedback/queue/admission.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Feedback Queue Filter, Backpropagation & Drainage Suite (filter.ts)", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  const testDir = "/virtual/filter-test";
  const queuePath = `${testDir}/backlog.jsonl`;

  const item1: FeedbackItem = {
    id: "fb-1",
    timestamp: "2026-09-01T10:00:00.000Z",
    priority: "CRITICAL_USER_FEEDBACK",
    status: "PENDING",
    category: "ENGINE",
    title: "Engine crash fix",
    content: "Fix memory leak in engine loop",
  };

  const item2: FeedbackItem = {
    id: "fb-2",
    candidate_id: "cand-200",
    timestamp: "2026-09-01T11:00:00.000Z",
    priority: "HIGH_ARCHITECTURAL_FEATURE",
    status: "PENDING",
    category: "VALIDATION",
    title: "Add validation suite",
    content: "Improve coverage",
    test_path: "tests/old.test.ts",
    assertions: 5,
    runtime_ms: 120,
    commit_sha: "sha1111",
    resolution_note: "Initial note",
  };

  const item3: FeedbackItem = {
    id: "fb-3",
    timestamp: "2026-09-01T12:00:00.000Z",
    priority: "NORMAL",
    status: "COMPLETED",
    category: "ARCHITECTURE",
    title: "Doc cleanup",
    content: "Clean up comments",
  };

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    vfs.mkdirSync(testDir, { recursive: true });
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    session.cleanup();
  });

  describe("backpropagateFeedbackResolution", () => {
    it("returns empty array immediately when records list is empty", () => {
      const result = backpropagateFeedbackResolution([], queuePath);
      expect(result).toEqual([]);
    });

    it("resolves feedback matched by direct item ID without explicit resolution object", () => {
      writeFeedbackQueue([item1, item3], queuePath);
      const records: BackpropagationRecord[] = [
        {
          id: "fb-1",
          completed_at: "2026-09-01T15:30:00.000Z",
          test_path: "tests/engine.test.ts",
          assertions: ["asserts memory reclaimed"],
          runtime_ms: 450,
          commit_sha: "abc1234",
          proof_summary: "Reclaimed all leaked buffers",
        },
      ];

      const updated = backpropagateFeedbackResolution(records, queuePath);
      expect(updated).toHaveLength(1);
      expect(updated[0]!.id).toBe("fb-1");
      expect(updated[0]!.status).toBe("COMPLETED");
      expect(updated[0]!.processed_at).toBe("2026-09-01T15:30:00.000Z");
      expect(updated[0]!.test_path).toBe("tests/engine.test.ts");
      expect(updated[0]!.assertions).toEqual(["asserts memory reclaimed"]);
      expect(updated[0]!.runtime_ms).toBe(450);
      expect(updated[0]!.commit_sha).toBe("abc1234");
      expect(updated[0]!.resolution_note).toBe("Reclaimed all leaked buffers");
      expect(updated[0]!.resolution?.task_id).toBe("fb-1");
      expect(updated[0]!.resolution?.resolved_at).toBe("2026-09-01T15:30:00.000Z");
      expect(updated[0]!.resolution?.proof_summary).toBe("Reclaimed all leaked buffers");
    });

    it("resolves feedback matched by candidate_id using metadata fallback keys", () => {
      writeFeedbackQueue([item2], queuePath);
      const records: BackpropagationRecord[] = [
        {
          id: "cand-200",
          metadata: {
            test_path: "tests/meta-test.ts",
            test_assertions: 12,
            runtime: 88,
            commit_sha: "commit-meta-sha",
          },
        },
      ];

      const updated = backpropagateFeedbackResolution(records, queuePath);
      expect(updated).toHaveLength(1);
      expect(updated[0]!.id).toBe("fb-2");
      expect(updated[0]!.status).toBe("COMPLETED");
      expect(updated[0]!.test_path).toBe("tests/meta-test.ts");
      expect(updated[0]!.assertions).toBe(12);
      expect(updated[0]!.runtime_ms).toBe(88);
      expect(updated[0]!.commit_sha).toBe("commit-meta-sha");
      expect(updated[0]!.resolution_note).toBe("Initial note");
    });

    it("resolves feedback with validated resolution proof object and fallback proof summary", () => {
      const itemMinimal: FeedbackItem = {
        id: "fb-min",
        timestamp: "2026-09-01T09:00:00.000Z",
        priority: "LOW",
        status: "PENDING",
        category: "GENERAL",
        title: "Min item",
        content: "Content",
      };
      writeFeedbackQueue([itemMinimal], queuePath);

      const records: BackpropagationRecord[] = [
        {
          id: "fb-min",
          metadata: { assertions: 10, runtime_ms: 200 },
          resolution: {
            task_id: "fb-min",
            resolved_at: "2026-09-01T16:00:00.000Z",
            proof_summary: "Custom verified proof",
          },
        },
      ];

      const updated = backpropagateFeedbackResolution(records, queuePath);
      expect(updated).toHaveLength(1);
      expect(updated[0]!.resolution?.proof_summary).toBe("Custom verified proof");
    });

    it("leaves non-matching feedback items intact", () => {
      writeFeedbackQueue([item1, item2], queuePath);
      const records: BackpropagationRecord[] = [{ id: "unmatched-task-id" }];
      const updated = backpropagateFeedbackResolution(records, queuePath);
      expect(updated).toHaveLength(0);
    });
  });

  describe("drainPendingFeedbacks", () => {
    it("drains all pending items marking them as PROCESSED by default", () => {
      writeFeedbackQueue([item1, item2, item3], queuePath);
      const drained = drainPendingFeedbacks({}, queuePath);
      expect(drained).toHaveLength(2);
      expect(drained.map((d) => d.id)).toEqual(["fb-1", "fb-2"]);
      expect(drained[0]!.status).toBe("PROCESSED");
      expect(drained[1]!.status).toBe("PROCESSED");
      expect(drained[0]!.processed_at).toBeTruthy();
    });

    it("drains pending items with limit, custom status, category filter, and predicate", () => {
      const pendingItems: FeedbackItem[] = [
        { ...item1, id: "p1", category: "VALIDATION", priority: "CRITICAL_USER_FEEDBACK" },
        { ...item1, id: "p2", category: "VALIDATION", priority: "HIGH_ARCHITECTURAL_FEATURE" },
        { ...item1, id: "p3", category: "VALIDATION", priority: "HIGH_ARCHITECTURAL_FEATURE" },
        { ...item1, id: "p4", category: "ENGINE", priority: "CRITICAL_USER_FEEDBACK" },
      ];
      writeFeedbackQueue(pendingItems, queuePath);

      const drained = drainPendingFeedbacks(
        {
          markAs: "ADMITTED",
          category: "VALIDATION",
          limit: 1,
          filter: (item) => item.priority === "HIGH_ARCHITECTURAL_FEATURE",
        },
        queuePath,
      );
      expect(drained).toHaveLength(1);
      expect(drained[0]!.id).toBe("p2");
      expect(drained[0]!.status).toBe("ADMITTED");
    });
  });

  describe("compareFeedbackPriority, sortFeedbackByPriority, and getFeedbackStats", () => {
    it("compares priority string literals and FeedbackItem objects", () => {
      expect(
        compareFeedbackPriority("CRITICAL_USER_FEEDBACK", "HIGH_ARCHITECTURAL_FEATURE"),
      ).toBeLessThan(0);
      expect(
        compareFeedbackPriority("HIGH_ARCHITECTURAL_FEATURE", "CRITICAL_USER_FEEDBACK"),
      ).toBeGreaterThan(0);
      expect(compareFeedbackPriority("NORMAL", "NORMAL")).toBe(0);
      expect(compareFeedbackPriority("UNKNOWN" as any, "CRITICAL_USER_FEEDBACK")).toBeGreaterThan(
        0,
      );

      const early: FeedbackItem = { ...item1, id: "e", timestamp: "2026-09-01T08:00:00.000Z" };
      const late: FeedbackItem = { ...item1, id: "l", timestamp: "2026-09-01T09:00:00.000Z" };
      expect(compareFeedbackPriority(early, late)).toBeLessThan(0);
      expect(compareFeedbackPriority(late, early)).toBeGreaterThan(0);
      expect(compareFeedbackPriority(early, early)).toBe(0);
    });

    it("sorts items by priority rank and computes status statistics", () => {
      const items: FeedbackItem[] = [
        { ...item1, id: "low", priority: "LOW", status: "PENDING" },
        { ...item1, id: "crit", priority: "CRITICAL_USER_FEEDBACK", status: "COMPLETED" },
        { ...item1, id: "high", priority: "HIGH_ARCHITECTURAL_FEATURE", status: "ADMITTED" },
      ];
      expect(sortFeedbackByPriority(items).map((s) => s.id)).toEqual(["crit", "high", "low"]);

      expect(getFeedbackStats(items)).toEqual({
        total: 3,
        pending: 1,
        admitted: 1,
        declined: 0,
        processed: 0,
        completed: 1,
      });
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
});
