import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  withFeedbackQueueTransaction,
  writeFeedbackQueue,
} from "../../../../olt/scripts/src/mind/feedback/queue/admission.ts";
import { clearFeedbackQueue } from "../../../../olt/scripts/src/mind/feedback/queue/ops.ts";
import { readFeedbackQueue } from "../../../../olt/scripts/src/mind/feedback/queue/ingest.ts";
import {
  __setFeedbackQueuePersistenceTestHook,
  type FeedbackItem,
} from "../../../../olt/scripts/src/mind/feedback/queue/types.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Mind Feedback Queue Core Mechanics Suite", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  const testDir = "/virtual/mind/feedback/queue";
  const queuePath = `${testDir}/backlog.jsonl`;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    vfs.mkdirSync(testDir, { recursive: true });
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    __setFeedbackQueuePersistenceTestHook(undefined);
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

  describe("Serialization & Duplicate ID Validation", () => {
    it("writes and reads back feedback items with strict ordering", () => {
      const item1 = makeItem("fb-1", { priority: "LOW" });
      const item2 = makeItem("fb-2", { priority: "CRITICAL_USER_FEEDBACK" });

      writeFeedbackQueue([item1, item2], queuePath);
      const items = readFeedbackQueue(queuePath);

      expect(items.length).toBe(2);
      expect(items[0]?.id).toBe("fb-2"); // Higher priority sorted first
      expect(items[1]?.id).toBe("fb-1");
    });

    it("throws INTEGRITY error when writeFeedbackQueue receives duplicate IDs", () => {
      const dupItems = [makeItem("fb-dup"), makeItem("fb-dup")];

      expect(() => writeFeedbackQueue(dupItems, queuePath)).toThrow(HarnessError);
      try {
        writeFeedbackQueue(dupItems, queuePath);
      } catch (err: unknown) {
        expect(err instanceof HarnessError).toBe(true);
        expect((err as HarnessError).code).toBe("INTEGRITY");
        expect((err as Error).message).toContain("duplicates id 'fb-dup'");
      }
    });
  });

  describe("Atomic Transaction Semantics & Rollback", () => {
    it("executes mutation transaction and forwards custom return value", () => {
      writeFeedbackQueue([makeItem("fb-10")], queuePath);

      const count = withFeedbackQueueTransaction(queuePath, (existing) => {
        const next = [...existing, makeItem("fb-20")];
        return { items: next, result: next.length };
      });

      expect(count).toBe(2);
      const updated = readFeedbackQueue(queuePath);
      expect(updated.length).toBe(2);
      expect(updated.map((i) => i.id)).toEqual(["fb-10", "fb-20"]);
    });

    it("rolls back and preserves existing queue when transaction mutator throws", () => {
      writeFeedbackQueue([makeItem("fb-initial")], queuePath);

      expect(() =>
        withFeedbackQueueTransaction(queuePath, () => {
          throw new HarnessError("INTEGRITY", "Simulated transaction abort");
        }),
      ).toThrow(HarnessError);

      const itemsAfterAbort = readFeedbackQueue(queuePath);
      expect(itemsAfterAbort.length).toBe(1);
      expect(itemsAfterAbort[0]?.id).toBe("fb-initial");
    });
  });

  describe("Persistence Hooks & Queue Clear", () => {
    it("triggers registered persistence hooks across write lifecycle stages", () => {
      const stages: string[] = [];
      __setFeedbackQueuePersistenceTestHook((stage) => {
        stages.push(stage);
      });

      writeFeedbackQueue([makeItem("fb-hook-1")], queuePath);

      expect(stages).toContain("before_write");
      expect(stages).toContain("before_file_fsync");
      expect(stages).toContain("before_rename");
      expect(stages).toContain("after_rename");
      expect(stages).toContain("before_directory_fsync");
    });

    it("clears feedback queue atomically to an empty state", () => {
      writeFeedbackQueue([makeItem("fb-c1"), makeItem("fb-c2")], queuePath);
      expect(readFeedbackQueue(queuePath).length).toBe(2);

      clearFeedbackQueue(queuePath);
      expect(readFeedbackQueue(queuePath)).toEqual([]);
    });
  });
});
