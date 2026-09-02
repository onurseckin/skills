import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatCompletedTasksBrief,
  getCompletedTasksStats,
  readCompletedTasksLedger,
  recordCompletedTask,
  recordCompletedTasksBatch,
  recordCompletedTasksBatchUnlocked,
  updateDefectItems,
  updateFeedbackQueueItems,
  writeCompletedTasksLedger,
  writeCompletedTasksLedgerUnlocked,
} from "../../../olt/scripts/src/mind/archival/completed/ledger.ts";
import type { CompletedTaskRecord } from "../../../olt/scripts/src/mind/archival/completed/types.ts";
import {
  readFeedbackQueueStrict,
  writeFeedbackQueue,
} from "../../../olt/scripts/src/mind/feedback/queue/index.ts";
import type { FeedbackItem } from "../../../olt/scripts/src/mind/feedback/queue/types.ts";

const sampleTask1: CompletedTaskRecord = {
  id: "task-001",
  source: "task_queue",
  title: "Implement core ledger system",
  status: "COMPLETED",
  proof_summary: "All unit tests pass with green status",
  completed_at: "2026-09-01T12:00:00.000Z",
  category: "core",
};

const sampleTask2: CompletedTaskRecord = {
  id: "task-002",
  source: "defect",
  title: "Fix lock timeout race condition in atomic write operation",
  status: "RESOLVED",
  proof_summary: "Concurrency simulation verified lock safety",
  completed_at: "2026-09-01T13:00:00.000Z",
  category: "architecture",
};

describe("Completed Tasks Ledger Module", () => {
  let tempDir: string;
  let ledgerPath: string;
  let oltDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "completed-ledger-test-"));
    oltDir = join(tempDir, ".olt");
    mkdirSync(oltDir, { recursive: true });
    ledgerPath = join(oltDir, "completed-tasks.jsonl");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("readCompletedTasksLedger", () => {
    it("returns empty array if file does not exist", () => {
      expect(readCompletedTasksLedger(join(oltDir, "missing.jsonl"))).toEqual([]);
    });

    it("reads and parses valid JSONL ledger records", () => {
      writeFileSync(ledgerPath, `${JSON.stringify(sampleTask1)}\n${JSON.stringify(sampleTask2)}\n`);
      const records = readCompletedTasksLedger(ledgerPath);
      expect(records).toHaveLength(2);
      expect(records[0]?.id).toBe("task-001");
      expect(records[1]?.id).toBe("task-002");
    });

    it("skips blank lines seamlessly", () => {
      writeFileSync(ledgerPath, `\n\n${JSON.stringify(sampleTask1)}\n  \n`);
      const records = readCompletedTasksLedger(ledgerPath);
      expect(records).toHaveLength(1);
      expect(records[0]?.id).toBe("task-001");
    });

    it("throws HarnessError INTEGRITY on malformed JSON", () => {
      writeFileSync(ledgerPath, `${JSON.stringify(sampleTask1)}\n{invalid-json\n`);
      expect(() => readCompletedTasksLedger(ledgerPath)).toThrow(
        /completed tasks ledger line 2 is malformed/,
      );
    });

    it("throws HarnessError INTEGRITY when record validation fails", () => {
      const badRecord = { id: "bad-1", source: "invalid-source" };
      writeFileSync(ledgerPath, `${JSON.stringify(badRecord)}\n`);
      expect(() => readCompletedTasksLedger(ledgerPath)).toThrow(
        /completed tasks ledger line 1: CompletedTaskRecord requires valid source/,
      );
    });
  });

  describe("writeCompletedTasksLedger & writeCompletedTasksLedgerUnlocked", () => {
    it("writes and reads back ledger records atomically", () => {
      writeCompletedTasksLedger([sampleTask1, sampleTask2], ledgerPath);
      const readBack = readCompletedTasksLedger(ledgerPath);
      expect(readBack).toHaveLength(2);
      expect(readBack[0]?.title).toBe(sampleTask1.title);
    });

    it("writes empty file when passed empty records", () => {
      writeCompletedTasksLedgerUnlocked([], ledgerPath);
      expect(existsSync(ledgerPath)).toBe(true);
      expect(readFileSync(ledgerPath, "utf8")).toBe("");
      expect(readCompletedTasksLedger(ledgerPath)).toEqual([]);
    });
  });

  describe("updateFeedbackQueueItems", () => {
    it("prunes feedback items matching record id, candidate id, or status COMPLETED", () => {
      const feedbackPath = join(oltDir, "feedback-queue.jsonl");
      const f1: FeedbackItem = {
        id: "fb-1",
        timestamp: "2026-09-01T10:00:00.000Z",
        title: "User feedback 1",
        content: "Detailed content 1",
        priority: "NORMAL",
        category: "CLI_TOOLING",
        status: "PENDING",
      };
      const f2: FeedbackItem = {
        id: "fb-2",
        candidate_id: "task-001",
        timestamp: "2026-09-01T10:30:00.000Z",
        title: "Candidate task feedback",
        content: "Detailed content 2",
        priority: "HIGH_ARCHITECTURAL_FEATURE",
        category: "CORE_ENGINE",
        status: "ADMITTED",
      };
      const f3: FeedbackItem = {
        id: "fb-3",
        timestamp: "2026-09-01T11:00:00.000Z",
        title: "Already completed item",
        content: "Detailed content 3",
        priority: "LOW",
        category: "GENERAL",
        status: "COMPLETED",
      };
      const f4: FeedbackItem = {
        id: "fb-4",
        timestamp: "2026-09-01T11:30:00.000Z",
        title: "Remaining pending feedback",
        content: "Detailed content 4",
        priority: "NORMAL",
        category: "GENERAL",
        status: "PENDING",
      };

      writeFeedbackQueue([f1, f2, f3, f4], feedbackPath);
      const completion: CompletedTaskRecord = {
        id: "fb-1",
        source: "feedback_queue",
        title: "Resolved fb-1",
        status: "RESOLVED",
        proof_summary: "Resolved",
        completed_at: "2026-09-01T12:00:00.000Z",
      };

      updateFeedbackQueueItems([completion, sampleTask1], feedbackPath);
      const remaining = readFeedbackQueueStrict(feedbackPath);
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.id).toBe("fb-4");
    });
  });

  describe("updateDefectItems", () => {
    it("returns early if defect file does not exist", () => {
      expect(() =>
        updateDefectItems([sampleTask1], join(oltDir, "nonexistent-defects.jsonl")),
      ).not.toThrow();
    });

    it("prunes defects matching completed task ids or with resolved/closed status", () => {
      const defectsPath = join(oltDir, "defects.jsonl");
      const d1 = { id: "def-1", status: "open", description: "Bug 1" };
      const d2 = { id: "task-002", status: "open", description: "Bug matching task-002" };
      const d3 = { id: "def-3", status: "resolved", description: "Bug resolved" };
      const d4 = { id: "def-4", status: "CLOSED", description: "Bug closed" };
      writeFileSync(defectsPath, `${[d1, d2, d3, d4].map((d) => JSON.stringify(d)).join("\n")}\n`);

      updateDefectItems([sampleTask2], defectsPath);
      const remainingContent = readFileSync(defectsPath, "utf8");
      expect(remainingContent).toContain("def-1");
      expect(remainingContent).not.toContain("task-002");
      expect(remainingContent).not.toContain("def-3");
      expect(remainingContent).not.toContain("def-4");
    });
  });

  describe("recordCompletedTasksBatch & recordCompletedTask", () => {
    it("returns empty array when batch is empty", () => {
      expect(recordCompletedTasksBatch([])).toEqual([]);
    });

    it("records batch and merges updates with existing records", () => {
      writeCompletedTasksLedger([sampleTask1], ledgerPath);
      const updatedTask1: CompletedTaskRecord = { ...sampleTask1, title: "Updated task 1 title" };
      const recorded = recordCompletedTasksBatch([updatedTask1, sampleTask2], {
        customPath: ledgerPath,
      });
      expect(recorded).toHaveLength(2);
      const current = readCompletedTasksLedger(ledgerPath);
      expect(current).toHaveLength(2);
      expect(current.find((r) => r.id === "task-001")?.title).toBe("Updated task 1 title");
      expect(current.find((r) => r.id === "task-002")?.title).toBe(sampleTask2.title);
    });

    it("triggers feedback queue and defect updates when options are set", () => {
      const feedbackPath = join(oltDir, "feedback-queue.jsonl");
      const defectsPath = join(oltDir, "defects.jsonl");
      writeFeedbackQueue(
        [
          {
            id: "task-001",
            timestamp: "2026-09-01T10:00:00.000Z",
            title: "Feedback matching task-001",
            content: "Detailed feedback content",
            priority: "NORMAL",
            category: "CLI_TOOLING",
            status: "PENDING",
          },
        ],
        feedbackPath,
      );
      writeFileSync(
        defectsPath,
        `${JSON.stringify({ id: "task-001", status: "open", description: "Defect 1" })}\n`,
      );

      const res = recordCompletedTask(sampleTask1, {
        customPath: ledgerPath,
        feedbackQueuePath: feedbackPath,
        updateFeedbackQueue: true,
        defectsPath,
        updateDefects: true,
      });

      expect(res.id).toBe("task-001");
      expect(readFeedbackQueueStrict(feedbackPath)).toEqual([]);
      expect(readFileSync(defectsPath, "utf8")).toBe("");
    });
  });

  describe("getCompletedTasksStats", () => {
    it("computes stats for various sources and categories including fallbacks", () => {
      const taskWithEmptySource: CompletedTaskRecord = {
        ...sampleTask1,
        id: "task-direct",
        source: "" as any,
        category: "  ",
      };
      const stats = getCompletedTasksStats([sampleTask1, sampleTask2, taskWithEmptySource]);
      expect(stats.total).toBe(3);
      expect(stats.by_source["task_queue"]).toBe(1);
      expect(stats.by_source["defect"]).toBe(1);
      expect(stats.by_source["direct"]).toBe(1);
      expect(stats.by_category["core"]).toBe(1);
      expect(stats.by_category["architecture"]).toBe(1);
      expect(stats.by_category["uncategorized"]).toBe(1);
    });
  });

  describe("formatCompletedTasksBrief", () => {
    it("formats brief message when ledger has no records", () => {
      const brief = formatCompletedTasksBrief([], 50);
      expect(brief).toContain("### Completed Tasks Ledger");
      expect(brief).toContain("- **Total Completed**: 0");
      expect(brief).toContain("- **Status**: No tasks completed yet in ledger.");
      expect(brief).toContain("bun harness.ts mind:wake");
    });

    it("formats populated summary table with truncated titles and category breakdowns", () => {
      const longTitleTask: CompletedTaskRecord = {
        ...sampleTask1,
        id: "task-long",
        title: "This is an extraordinarily long task title that exceeds thirty characters by far",
        category: "refactoring",
      };
      const brief = formatCompletedTasksBrief([sampleTask1, sampleTask2, longTitleTask], 40);
      expect(brief).toContain("### Completed Tasks Ledger");
      expect(brief).toContain("- **Total Completed**: 3");
      expect(brief).toContain("- **By Source**:");
      expect(brief).toContain("- **By Category**:");
      expect(brief).toContain("#### Recent Completions:");
      expect(brief).toContain("This is an extraordinarily ...");
      expect(brief).toContain("task-001");
    });
  });
});
