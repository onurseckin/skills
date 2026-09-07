import { describe, expect, it, spyOn, afterEach } from "bun:test";
import { drainBacklogOnRunCompletion } from "../../../../olt/scripts/src/mind/tasks/smart/executor/product-owner.ts";
import * as feedbackQueueModule from "../../../../olt/scripts/src/mind/feedback/queue/index.ts";
import * as completedModule from "../../../../olt/scripts/src/mind/archival/completed/index.ts";
import type { FeedbackItem } from "../../../../olt/scripts/src/mind/feedback/queue/index.ts";

describe("Product Owner Executor Backlog Drain", () => {
  const spies: Array<{ mockRestore: () => void }> = [];
  afterEach(() => {
    while (spies.length > 0) spies.pop()?.mockRestore();
  });

  describe("drainBacklogOnRunCompletion", () => {
    it("returns zero counts when backlog is empty", () => {
      spies.push(spyOn(feedbackQueueModule, "readFeedbackQueue").mockReturnValue([]));
      const res = drainBacklogOnRunCompletion({});
      expect(res.drainedCount).toBe(0);
      expect(res.remainingBacklogCount).toBe(0);
      expect(res.archivedRecords.length).toBe(0);
    });

    it("drains completed, processed, declined, and explicit candidate IDs", () => {
      const items: FeedbackItem[] = [
        {
          id: "fb-1",
          timestamp: "2026-08-20T00:00:00.000Z",
          priority: "NORMAL",
          status: "DECLINED",
          category: "CORE_ENGINE",
          title: "Declined",
          content: "C1",
          resolution_note: "Declined note",
          processed_at: "2026-08-20T01:00:00.000Z",
          candidate_id: "cand-1",
          commit_sha: "abc1234",
          test_path: "tests/a.test.ts",
          assertions: 5,
          runtime_ms: 120,
          resolution: { task_id: "t-1", resolved_at: "2026-08-20T01:00:00.000Z" },
          metadata: { note: "sample" },
        },
        {
          id: "fb-2",
          timestamp: "2026-08-20T00:00:00.000Z",
          priority: "HIGH_ARCHITECTURAL_FEATURE",
          status: "COMPLETED",
          category: "ARCHITECTURE",
          title: "Completed",
          content: "C2",
          resolution: {
            task_id: "t-2",
            resolved_at: "2026-08-20T02:00:00.000Z",
            proof_summary: "Proof",
            commit_sha: "def",
            test_path: "tests/b.ts",
            assertions: 10,
            runtime_ms: 250,
          },
        },
        {
          id: "fb-3",
          timestamp: "2026-08-20T00:00:00.000Z",
          priority: "USER_DIRECTIVE",
          status: "PROCESSED",
          category: "DOCUMENTATION",
          title: "Processed",
          content: "C3",
        },
        {
          id: "fb-4",
          timestamp: "2026-08-20T00:00:00.000Z",
          priority: "NORMAL",
          status: "PENDING",
          category: "GENERAL",
          title: "Pending completed",
          content: "C4",
        },
        {
          id: "fb-5",
          timestamp: "2026-08-20T00:00:00.000Z",
          priority: "NORMAL",
          status: "PENDING",
          category: "GENERAL",
          title: "Pending untouched",
          content: "C5",
        },
        {
          id: "fb-6",
          timestamp: "2026-08-20T00:00:00.000Z",
          priority: "NORMAL",
          status: "PENDING",
          category: "GENERAL",
          title: "Pending cand match",
          content: "C6",
          candidate_id: "cand-6",
        },
      ];

      let readCount = 0;
      spies.push(
        spyOn(feedbackQueueModule, "readFeedbackQueue").mockImplementation(() => {
          readCount++;
          return readCount === 1 ? items : [items[4]!];
        }),
      );
      spies.push(spyOn(completedModule, "recordCompletedTasksBatch").mockImplementation(() => []));
      spies.push(
        spyOn(feedbackQueueModule, "updateOrPruneFeedbackItems").mockImplementation((fn) => {
          fn(items[0]!);
          fn(items[4]!);
          return [];
        }),
      );

      const res = drainBacklogOnRunCompletion({
        repoRoot: "/virtual/repo",
        completedTasks: ["fb-4", "cand-6"],
        runId: "run-99",
        commitSha: "sha-global",
        testPath: "tests/global.test.ts",
      });

      expect(res.drainedCount).toBe(5);
      expect(res.remainingBacklogCount).toBe(1);
      expect(res.archivedRecords.length).toBe(5);
      expect(res.archivedRecords[0]?.status).toBe("RESOLVED");
      expect(res.archivedRecords[1]?.status).toBe("COMPLETED");
      expect(res.archivedRecords[2]?.proof_summary).toBe("Completed under run run-99");
    });

    it("handles backlog with items where none are eligible to drain", () => {
      const items: FeedbackItem[] = [
        {
          id: "fb-stay-1",
          timestamp: "2026-08-20T00:00:00.000Z",
          priority: "NORMAL",
          status: "PENDING",
          category: "CORE_ENGINE",
          title: "Stay",
          content: "K",
        },
      ];
      spies.push(spyOn(feedbackQueueModule, "readFeedbackQueue").mockReturnValue(items));
      const recordSpy = spyOn(completedModule, "recordCompletedTasksBatch");
      spies.push(recordSpy);

      const res = drainBacklogOnRunCompletion({});
      expect(res.drainedCount).toBe(0);
      expect(res.remainingBacklogCount).toBe(1);
      expect(recordSpy).not.toHaveBeenCalled();
    });
  });
});
