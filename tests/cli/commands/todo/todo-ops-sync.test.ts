import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mindQueueCleanCommand,
  todoAddCommand,
  todoCleanCommand,
  todoDrainCommand,
  todoSealCommand,
} from "../../../../olt/scripts/src/cli/commands/todo-ops.ts";
import {
  readFeedbackQueue,
  writeFeedbackQueue,
} from "../../../../olt/scripts/src/mind/feedback/queue/index.ts";
import { readCompletedTasksLedger } from "../../../../olt/scripts/src/mind/archival/completed/index.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
  roots.length = 0;
});

function getTestDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `todo-sync-${label}-`));
  roots.push(dir);
  return dir;
}

describe("CLI todo-ops and mind:queue commands - Clean & Sync", () => {
  describe("todoCleanCommand and mindQueueCleanCommand", () => {
    it("rejects the direct completed-file alias before mutating canonical or outside files", () => {
      const testDir = getTestDir("clean-reject-completed-file-alias");
      const canonicalQueueFile = join(testDir, "feedback-queue.jsonl");
      const canonicalArchiveFile = join(testDir, "completed-tasks.jsonl");
      const outsideSentinelFile = join(testDir, "outside-sentinel.jsonl");

      writeFeedbackQueue(
        [
          {
            id: "canonical-pending",
            timestamp: "2026-08-27T00:00:00.000Z",
            priority: "NORMAL",
            status: "PENDING",
            category: "GENERAL",
            title: "Canonical pending item",
            content: "Must remain unchanged",
          },
        ],
        canonicalQueueFile,
      );
      writeFileSync(canonicalArchiveFile, "canonical archive sentinel\n", "utf-8");
      writeFileSync(outsideSentinelFile, "outside sentinel\n", "utf-8");

      const canonicalQueueBefore = readFileSync(canonicalQueueFile, "utf-8");
      const canonicalArchiveBefore = readFileSync(canonicalArchiveFile, "utf-8");
      const outsideSentinelBefore = readFileSync(outsideSentinelFile, "utf-8");

      let thrown: unknown;
      try {
        todoCleanCommand({ "completed-file": outsideSentinelFile });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toMatchObject({ code: "INVALID_ARGUMENT" });
      expect(readFileSync(canonicalQueueFile, "utf-8")).toBe(canonicalQueueBefore);
      expect(readFileSync(canonicalArchiveFile, "utf-8")).toBe(canonicalArchiveBefore);
      expect(readFileSync(outsideSentinelFile, "utf-8")).toBe(outsideSentinelBefore);
    });

    it("todo clean preserves a concurrent transactional addition", async () => {
      const testDir = getTestDir("todo-clean-concurrent-add");
      const queueFile = join(testDir, "feedback-queue.jsonl");
      const archiveFile = join(testDir, "completed-tasks.jsonl");
      writeFeedbackQueue(
        [
          {
            id: "todo-prune",
            timestamp: "2026-08-22T00:00:00.000Z",
            priority: "NORMAL",
            status: "COMPLETED",
            category: "GENERAL",
            title: "prune",
            content: "done",
          },
        ],
        queueFile,
      );
      const modulePath = join(process.cwd(), "olt/scripts/src/mind/feedback/queue/index.ts");
      const child = Bun.spawn({
        cmd: [
          "bun",
          "-e",
          `import { appendFeedbackItem } from ${JSON.stringify(modulePath)}; appendFeedbackItem({ id: "todo-concurrent", title: "keep", content: "keep", priority: "NORMAL", category: "GENERAL", status: "PENDING" }, process.argv.at(-1));`,
          queueFile,
        ],
        stdout: "pipe",
        stderr: "pipe",
      });
      todoCleanCommand({ "queue-file": queueFile, "archive-file": archiveFile });
      expect(await child.exited).toBe(0);
      expect(readFeedbackQueue(queueFile).map((item) => item.id)).toEqual(["todo-concurrent"]);
    });

    it("handles clean on empty or all-pending queue", () => {
      const testDir = getTestDir("clean-noop");
      const queueFile = join(testDir, "feedback-queue.jsonl");
      const archiveFile = join(testDir, "completed-tasks.jsonl");

      todoAddCommand({
        title: "Pending Item",
        content: "Not yet completed",
        "queue-file": queueFile,
      });

      const cleanRes = todoCleanCommand({
        "queue-file": queueFile,
        "archive-file": archiveFile,
      });

      expect(cleanRes.cleanedCount).toBe(0);
      expect(cleanRes.remainingCount).toBe(1);
      expect(cleanRes.archived).toEqual([]);
      expect(cleanRes.markdown).toContain("Pruned / Archived**: 0 items");

      const remaining = readFeedbackQueue(queueFile);
      expect(remaining).toHaveLength(1);
    });

    it("simulates clean in dry-run mode without modifying files", () => {
      const testDir = getTestDir("clean-dryrun");
      const queueFile = join(testDir, "feedback-queue.jsonl");
      const archiveFile = join(testDir, "completed-tasks.jsonl");

      const addRes = todoAddCommand({
        title: "Item To Be Sealed",
        content: "Content",
        "queue-file": queueFile,
      });

      todoSealCommand({
        id: addRes.item.id,
        resolution: "Finished and sealed",
        "queue-file": queueFile,
      });

      const dryRunRes = mindQueueCleanCommand({
        "queue-file": queueFile,
        "archive-file": archiveFile,
        "dry-run": true,
      });

      expect(dryRunRes.dryRun).toBe(true);
      expect(dryRunRes.cleanedCount).toBe(1);
      expect(dryRunRes.remainingCount).toBe(0);
      expect(dryRunRes.markdown).toContain("DRY RUN (no changes written)");

      const queueItems = readFeedbackQueue(queueFile);
      expect(queueItems).toHaveLength(1);
      const ledgerItems = readCompletedTasksLedger(archiveFile);
      expect(ledgerItems).toHaveLength(0);
    });

    it("prunes and archives completed and declined items to ledger file", () => {
      const testDir = getTestDir("clean-archive");
      const queueFile = join(testDir, "feedback-queue.jsonl");
      const archiveFile = join(testDir, "completed-tasks.jsonl");

      const item1 = todoAddCommand({
        id: "clean-task-1",
        title: "Very Long Task Title That Exceeds Thirty-Five Characters Easily",
        content: "Content 1",
        category: "CLI_TOOLING",
        "queue-file": queueFile,
      });

      const item2 = todoAddCommand({
        id: "clean-task-2",
        title: "Declined Task",
        content: "Content 2",
        category: "DOCUMENTATION",
        "queue-file": queueFile,
      });

      todoAddCommand({
        id: "clean-task-3",
        title: "Active Task",
        content: "Content 3",
        category: "ARCHITECTURE",
        "queue-file": queueFile,
      });

      todoSealCommand({
        id: item1.item.id,
        resolution: "Cleaned and verified with commit",
        commit: "fedcba987654",
        "test-path": "tests/cli/commands/todo/todo-ops-sync.test.ts",
        assertions: "12",
        "runtime-ms": "80",
        "queue-file": queueFile,
      });

      todoDrainCommand({
        category: "DOCUMENTATION",
        "mark-as": "DECLINED",
        "queue-file": queueFile,
      });

      const cleanRes = todoCleanCommand({
        "queue-path": queueFile,
        "archive-file": archiveFile,
      });

      expect(cleanRes.dryRun).toBe(false);
      expect(cleanRes.cleanedCount).toBe(2);
      expect(cleanRes.remainingCount).toBe(1);
      expect(cleanRes.markdown).toContain("Pruned / Archived**: 2 items");

      const remainingQueue = readFeedbackQueue(queueFile);
      expect(remainingQueue).toHaveLength(1);
      expect(remainingQueue[0]?.id).toBe("clean-task-3");

      const ledger = readCompletedTasksLedger(archiveFile);
      expect(ledger).toHaveLength(2);
      const archived1 = ledger.find((r) => r.id === "clean-task-1");
      expect(archived1?.status).toBe("COMPLETED");
      expect(archived1?.commit_sha).toBe("fedcba987654");
      expect(archived1?.test_path).toBe("tests/cli/commands/todo/todo-ops-sync.test.ts");
      expect(archived1?.assertions).toBe(12);
      expect(archived1?.runtime_ms).toBe(80);

      const archived2 = ledger.find((r) => r.id === "clean-task-2");
      expect(archived2?.status).toBe("RESOLVED");
    });
  });
});
