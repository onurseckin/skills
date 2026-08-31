import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mindQueueDrainCommand,
  mindQueueSealCommand,
  todoAddCommand,
  todoDrainCommand,
  todoSealCommand,
} from "../../../../olt/scripts/src/cli/commands/todo-ops.ts";
import {
  readFeedbackQueue,
  writeFeedbackQueue,
  type FeedbackItem,
} from "../../../../olt/scripts/src/mind/feedback/queue/index.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
  roots.length = 0;
});

function getTestDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `todo-lifecycle-${label}-`));
  roots.push(dir);
  return dir;
}

describe("CLI todo-ops and mind:queue commands - Drain & Seal", () => {
  describe("todoDrainCommand and mindQueueDrainCommand", () => {
    it("handles drain on empty queue", () => {
      const testDir = getTestDir("drain-empty");
      const queueFile = join(testDir, "feedback-queue.jsonl");

      const result = todoDrainCommand({ "queue-file": queueFile });
      expect(result.drainedCount).toBe(0);
      expect(result.items).toEqual([]);
      expect(result.item).toBeUndefined();
      expect(result.markdown).toContain("Mind Queue Drain: Empty");
    });

    it("drains items with FIFO priority ordering, custom mark-as, and category/priority filters", () => {
      const testDir = getTestDir("drain-filters");
      const queueFile = join(testDir, "feedback-queue.jsonl");

      const items: FeedbackItem[] = [
        {
          id: "item-low",
          timestamp: "2026-08-22T00:00:00.000Z",
          priority: "LOW",
          status: "PENDING",
          category: "DOCUMENTATION",
          title: "Low doc",
          content: "Fix typo",
        },
        {
          id: "item-crit",
          timestamp: "2026-08-22T00:01:00.000Z",
          priority: "CRITICAL_USER_FEEDBACK",
          status: "PENDING",
          category: "CORE_ENGINE",
          title: "Critical Engine Fix",
          content: "Fix memory corruption",
        },
        {
          id: "item-high-cli",
          timestamp: "2026-08-22T00:02:00.000Z",
          priority: "HIGH_ARCHITECTURAL_FEATURE",
          status: "PENDING",
          category: "CLI_TOOLING",
          title: "High CLI Feature",
          content: "Add new flags",
        },
      ];

      writeFeedbackQueue(items, queueFile);

      // Drain with category filter
      const drainCli = mindQueueDrainCommand({
        category: "CLI_TOOLING",
        "mark-as": "ADMITTED",
        "queue-file": queueFile,
      });
      expect(drainCli.drainedCount).toBe(1);
      expect(drainCli.item?.id).toBe("item-high-cli");
      expect(drainCli.item?.status).toBe("ADMITTED");

      // Verify updated queue status in storage
      const queueAfterCli = readFeedbackQueue(queueFile);
      const cliItem = queueAfterCli.find((i) => i.id === "item-high-cli");
      expect(cliItem?.status).toBe("ADMITTED");

      // Drain next item (FIFO priority orders CRITICAL before LOW)
      const drainCrit = todoDrainCommand({
        limit: "1",
        "queue-file": queueFile,
      });
      expect(drainCrit.drainedCount).toBe(1);
      expect(drainCrit.item?.id).toBe("item-crit");
      expect(drainCrit.item?.status).toBe("PROCESSED");

      // Drain remaining with priority filter
      const drainLow = todoDrainCommand({
        priority: "LOW",
        "mark-as": "DECLINED",
        "queue-file": queueFile,
      });
      expect(drainLow.drainedCount).toBe(1);
      expect(drainLow.item?.id).toBe("item-low");
      expect(drainLow.item?.status).toBe("DECLINED");
    });
  });

  describe("todoSealCommand and mindQueueSealCommand", () => {
    it("seals item with resolution proof, commit sha, test path, and assertions", () => {
      const testDir = getTestDir("seal-standard");
      const queueFile = join(testDir, "feedback-queue.jsonl");

      const addRes = todoAddCommand({
        id: "seal-target",
        title: "Feature to Seal",
        content: "Complete and verify",
        "queue-file": queueFile,
      });
      expect(addRes.item.id).toBe("seal-target");

      const sealRes = mindQueueSealCommand({
        id: "seal-target",
        resolution: "Successfully implemented and unit tested",
        commit: "a1b2c3d4e5f6",
        "test-path": "tests/cli/commands/todo/todo-ops-lifecycle.test.ts",
        assertions: "15",
        "runtime-ms": "42",
        "queue-file": queueFile,
      });

      expect(sealRes.sealed).toBe(true);
      expect(sealRes.item.id).toBe("seal-target");
      expect(sealRes.item.status).toBe("COMPLETED");
      expect(sealRes.item.commit_sha).toBe("a1b2c3d4e5f6");
      expect(sealRes.item.test_path).toBe("tests/cli/commands/todo/todo-ops-lifecycle.test.ts");
      expect(sealRes.item.assertions).toBe(15);
      expect(sealRes.item.runtime_ms).toBe(42);
      expect(sealRes.item.resolution_note).toBe("Successfully implemented and unit tested");
      expect(sealRes.markdown).toContain("Mind Queue Item Sealed");
      expect(sealRes.markdown).toContain("a1b2c3d4e5f6");
      expect(sealRes.markdown).toContain("tests/cli/commands/todo/todo-ops-lifecycle.test.ts");

      const read = readFeedbackQueue(queueFile);
      expect(read[0]?.status).toBe("COMPLETED");
      expect(read[0]?.resolution?.commit_sha).toBe("a1b2c3d4e5f6");
    });

    it("seals item with note/summary fallback and enforces empirical constraints", () => {
      const testDir = getTestDir("seal-constraints");
      const queueFile = join(testDir, "feedback-queue.jsonl");

      todoAddCommand({
        id: "seal-target-2",
        title: "Feature 2",
        content: "Details",
        "queue-file": queueFile,
      });

      const sealRes = todoSealCommand({
        id: "seal-target-2",
        summary: "Verified via summary note",
        "queue-file": queueFile,
      });
      expect(sealRes.item.status).toBe("COMPLETED");
      expect(sealRes.item.resolution_note).toBe("Verified via summary note");

      todoAddCommand({
        id: "seal-target-3",
        title: "Feature 3",
        content: "Details",
        "queue-file": queueFile,
      });

      expect(() => {
        todoSealCommand({
          id: "seal-target-3",
          resolution: "Fix done",
          "require-commit-sha": true,
          "queue-file": queueFile,
        });
      }).toThrow();

      expect(() => {
        todoSealCommand({
          id: "seal-target-3",
          resolution: "Fix done",
          commit: "12345678",
          "require-test-path": true,
          "queue-file": queueFile,
        });
      }).toThrow();
    });

    it("throws error when sealing non-existent item", () => {
      const testDir = getTestDir("seal-nonexistent");
      const queueFile = join(testDir, "feedback-queue.jsonl");

      expect(() => {
        todoSealCommand({
          id: "no-such-id",
          resolution: "Did nothing",
          "queue-file": queueFile,
        });
      }).toThrow();
    });
  });
});
