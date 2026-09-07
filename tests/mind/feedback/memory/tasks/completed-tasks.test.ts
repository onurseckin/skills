import { describe, expect, it, beforeEach, afterEach } from "bun:test";
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
} from "../../../../../olt/scripts/src/mind/archival/completed/ledger.ts";
import type { CompletedTaskRecord } from "../../../../../olt/scripts/src/mind/archival/completed/types.ts";
import {
  readFeedbackQueueStrict,
  writeFeedbackQueue,
} from "../../../../../olt/scripts/src/mind/feedback/queue/index.ts";
import type { FeedbackItem } from "../../../../../olt/scripts/src/mind/feedback/queue/types.ts";
import { VirtualMemoryFS } from "../../../../../olt/scripts/src/testing/virtual-fs/memory-fs.ts";
import { createVirtualFSSession } from "../../../../../olt/scripts/src/testing/virtual-fs/spies.ts";

const sampleTask1: CompletedTaskRecord = {
  id: "task-001",
  source: "task_queue",
  title: "Implement cognitive telemetry tracking",
  status: "COMPLETED",
  proof_summary: "All unit tests pass with zero I/O",
  completed_at: "2026-09-01T12:00:00.000Z",
  category: "core",
};

const sampleTask2: CompletedTaskRecord = {
  id: "task-002",
  source: "defect",
  title: "Resolve memory leak in telemetry stream listeners",
  status: "RESOLVED",
  proof_summary: "Verified memory reclaim via heap profiling",
  completed_at: "2026-09-01T13:00:00.000Z",
  category: "architecture",
};

describe("Completed Tasks Archival Sub-Suite", () => {
  let vfs: VirtualMemoryFS;
  let session: ReturnType<typeof createVirtualFSSession>;
  const baseDir = "/virtual/completed-tasks";
  const ledgerPath = `${baseDir}/completed-tasks.jsonl`;
  const feedbackPath = `${baseDir}/feedback-queue.jsonl`;
  const defectsPath = `${baseDir}/defects.jsonl`;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
    vfs.mkdirSync(baseDir, { recursive: true });
  });

  afterEach(() => {
    session.cleanup();
  });

  describe("readCompletedTasksLedger", () => {
    it("returns empty array if file does not exist", () => {
      expect(readCompletedTasksLedger(`${baseDir}/nonexistent.jsonl`)).toEqual([]);
    });

    it("reads valid JSONL records and skips blank lines", () => {
      vfs.writeFileSync(
        ledgerPath,
        `\n${JSON.stringify(sampleTask1)}\n  \n${JSON.stringify(sampleTask2)}\n`,
      );
      const records = readCompletedTasksLedger(ledgerPath);
      expect(records).toHaveLength(2);
      expect(records[0]?.id).toBe("task-001");
      expect(records[1]?.id).toBe("task-002");
    });

    it("throws HarnessError on malformed JSON", () => {
      vfs.writeFileSync(ledgerPath, `${JSON.stringify(sampleTask1)}\n{bad-json-syntax\n`);
      expect(() => readCompletedTasksLedger(ledgerPath)).toThrow(/malformed/);
    });

    it("throws HarnessError when record schema validation fails", () => {
      const invalidRecord = { id: "bad-task", source: "unrecognized-source" };
      vfs.writeFileSync(ledgerPath, `${JSON.stringify(invalidRecord)}\n`);
      expect(() => readCompletedTasksLedger(ledgerPath)).toThrow(/requires valid source/);
    });
  });

  describe("writeCompletedTasksLedger", () => {
    it("writes and reads back ledger records atomically in virtual memory", () => {
      writeCompletedTasksLedger([sampleTask1, sampleTask2], ledgerPath);
      const records = readCompletedTasksLedger(ledgerPath);
      expect(records).toHaveLength(2);
      expect(records[0]?.title).toBe(sampleTask1.title);
      expect(records[1]?.title).toBe(sampleTask2.title);
    });

    it("writes empty file when passed empty records", () => {
      writeCompletedTasksLedgerUnlocked([], ledgerPath);
      expect(vfs.existsSync(ledgerPath)).toBe(true);
      expect(readCompletedTasksLedger(ledgerPath)).toEqual([]);
    });
  });

  describe("recordCompletedTasksBatch & recordCompletedTask", () => {
    it("returns empty array when batch is empty", () => {
      expect(recordCompletedTasksBatch([])).toEqual([]);
    });

    it("records batch unlocked directly into virtual ledger", () => {
      const unlocked = recordCompletedTasksBatchUnlocked([sampleTask1], undefined, ledgerPath);
      expect(unlocked).toHaveLength(1);
      expect(readCompletedTasksLedger(ledgerPath)).toHaveLength(1);
    });

    it("merges batch updates by id and updates existing entries", () => {
      writeCompletedTasksLedger([sampleTask1], ledgerPath);
      const updatedTask1: CompletedTaskRecord = {
        ...sampleTask1,
        title: "Updated task 001 title in virtual ledger",
      };

      const recorded = recordCompletedTasksBatch([updatedTask1, sampleTask2], {
        customPath: ledgerPath,
      });
      expect(recorded).toHaveLength(2);

      const current = readCompletedTasksLedger(ledgerPath);
      expect(current).toHaveLength(2);
      expect(current.find((r) => r.id === "task-001")?.title).toBe(updatedTask1.title);
      expect(current.find((r) => r.id === "task-002")?.title).toBe(sampleTask2.title);
    });

    it("records single completed task and triggers queue and defect updates", () => {
      writeFeedbackQueue(
        [
          {
            id: "task-001",
            timestamp: "2026-09-01T10:00:00.000Z",
            title: "Matching task queue item",
            content: "Detailed content",
            priority: "NORMAL",
            category: "CLI_TOOLING",
            status: "PENDING",
          },
        ],
        feedbackPath,
      );
      vfs.writeFileSync(
        defectsPath,
        `${JSON.stringify({ id: "task-001", status: "open", description: "Bug 1" })}\n`,
      );

      const result = recordCompletedTask(sampleTask1, {
        customPath: ledgerPath,
        feedbackQueuePath: feedbackPath,
        updateFeedbackQueue: true,
        defectsPath,
        updateDefects: true,
      });

      expect(result.id).toBe("task-001");
      expect(readFeedbackQueueStrict(feedbackPath)).toEqual([]);
      expect(vfs.readFileSync(defectsPath, "utf8")).toBe("");
    });
  });

  describe("updateFeedbackQueueItems", () => {
    it("prunes completed task IDs and candidate IDs while preserving active backlog", () => {
      const activeItem: FeedbackItem = {
        id: "fb-pending",
        timestamp: "2026-09-01T10:00:00.000Z",
        title: "Active pending feedback",
        content: "Still to do",
        priority: "NORMAL",
        category: "GENERAL",
        status: "PENDING",
      };
      const matchingIdItem: FeedbackItem = {
        id: "task-001",
        timestamp: "2026-09-01T10:30:00.000Z",
        title: "Item with matching ID",
        content: "Completed now",
        priority: "NORMAL",
        category: "CORE_ENGINE",
        status: "PENDING",
      };
      const candidateItem: FeedbackItem = {
        id: "fb-candidate",
        candidate_id: "task-002",
        timestamp: "2026-09-01T11:00:00.000Z",
        title: "Candidate item",
        content: "Matched by candidate_id",
        priority: "HIGH_ARCHITECTURAL_FEATURE",
        category: "CORE_ENGINE",
        status: "ADMITTED",
      };
      const alreadyCompletedItem: FeedbackItem = {
        id: "fb-completed",
        timestamp: "2026-09-01T11:30:00.000Z",
        title: "Already completed item",
        content: "Status is COMPLETED",
        priority: "LOW",
        category: "GENERAL",
        status: "COMPLETED",
      };

      writeFeedbackQueue(
        [activeItem, matchingIdItem, candidateItem, alreadyCompletedItem],
        feedbackPath,
      );
      updateFeedbackQueueItems([sampleTask1, sampleTask2], feedbackPath);

      const remaining = readFeedbackQueueStrict(feedbackPath);
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.id).toBe("fb-pending");
    });
  });

  describe("updateDefectItems", () => {
    it("safely handles non-existent defect file", () => {
      expect(() =>
        updateDefectItems([sampleTask1], `${baseDir}/nonexistent-defects.jsonl`),
      ).not.toThrow();
    });

    it("prunes matching defect IDs and closed/resolved defects from ledger", () => {
      const d1 = { id: "def-open-1", status: "open", description: "Unrelated open bug" };
      const d2 = { id: "task-002", status: "open", description: "Resolved by task-002" };
      const d3 = { id: "def-closed", status: "CLOSED", description: "Closed defect" };
      const d4 = { id: "def-resolved", status: "resolved", description: "Resolved defect" };

      vfs.writeFileSync(
        defectsPath,
        `${[d1, d2, d3, d4].map((d) => JSON.stringify(d)).join("\n")}\n`,
      );
      updateDefectItems([sampleTask2], defectsPath);

      const content = vfs.readFileSync(defectsPath, "utf8");
      expect(content).toContain("def-open-1");
      expect(content).not.toContain("task-002");
      expect(content).not.toContain("def-closed");
      expect(content).not.toContain("def-resolved");
    });
  });

  describe("getCompletedTasksStats & formatCompletedTasksBrief", () => {
    it("aggregates stats by source and category with graceful fallbacks", () => {
      const fallbackTask: CompletedTaskRecord = {
        ...sampleTask1,
        id: "task-fallback",
        source: "" as CompletedTaskRecord["source"],
        category: "  ",
      };

      const stats = getCompletedTasksStats([sampleTask1, sampleTask2, fallbackTask]);
      expect(stats.total).toBe(3);
      expect(stats.by_source["task_queue"]).toBe(1);
      expect(stats.by_source["defect"]).toBe(1);
      expect(stats.by_source["direct"]).toBe(1);
      expect(stats.by_category["core"]).toBe(1);
      expect(stats.by_category["architecture"]).toBe(1);
      expect(stats.by_category["uncategorized"]).toBe(1);
    });

    it("formats brief for empty ledger cleanly", () => {
      const brief = formatCompletedTasksBrief([]);
      expect(brief).toContain("### Completed Tasks Ledger");
      expect(brief).toContain("- **Total Completed**: 0");
      expect(brief).toContain("- **Status**: No tasks completed yet in ledger.");
    });

    it("formats brief with populated statistics and truncated title table", () => {
      const longTitleTask: CompletedTaskRecord = {
        ...sampleTask1,
        id: "task-long",
        title: "Excessively elongated description that exceeds thirty chars easily",
        category: "optimization",
      };

      const brief = formatCompletedTasksBrief([sampleTask1, sampleTask2, longTitleTask], 35);
      expect(brief).toContain("### Completed Tasks Ledger");
      expect(brief).toContain("- **Total Completed**: 3");
      expect(brief).toContain("- **By Source**:");
      expect(brief).toContain("- **By Category**:");
      expect(brief).toContain("#### Recent Completions:");
      expect(brief).toContain("Excessively elongated descr...");
    });
  });
});
