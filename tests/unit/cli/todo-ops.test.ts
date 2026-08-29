import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  mindQueueAddCommand,
  mindQueueCleanCommand,
  mindQueueDrainCommand,
  mindQueueListCommand,
  mindQueueSealCommand,
  todoAddCommand,
  todoCleanCommand,
  todoDrainCommand,
  todoListCommand,
  todoSealCommand,
} from "../../../olt/scripts/src/cli/commands/todo-ops.ts";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import {
  readFeedbackQueue,
  writeFeedbackQueue,
  type FeedbackItem,
} from "../../../olt/scripts/src/mind/feedback/queue/index.ts";
import { readCompletedTasksLedger } from "../../../olt/scripts/src/mind/archival/completed/index.ts";
import { registerSessionGrant } from "../../../olt/scripts/src/authority/session-registry.ts";
import { initRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

function authorizeMind(repo: string): string {
  const run = initRun(repo, "todo-authority", new TextEncoder().encode("prompt"), "file", true);
  transact(run, "test-setup", "grant-agent", {}, (draft) => {
    draft.agents = [
      {
        id: "mind",
        role: "mind",
        parent_agent_id: null,
        parent_task_id: null,
        host: "test",
        granted_at: new Date().toISOString(),
        status: "active",
      },
    ];
  });
  registerSessionGrant({ runRoot: run, agentId: "mind", role: "mind" });
  return run;
}

describe("CLI todo-ops and mind:queue commands", () => {
  it("verifies direct function aliases match between mindQueue* and todo*", () => {
    expect(mindQueueListCommand).toBe(todoListCommand);
    expect(mindQueueAddCommand).toBe(todoAddCommand);
    expect(mindQueueDrainCommand).toBe(todoDrainCommand);
    expect(mindQueueSealCommand).toBe(todoSealCommand);
    expect(mindQueueCleanCommand).toBe(todoCleanCommand);
  });

  describe("todoAddCommand and mindQueueAddCommand", () => {
    it("adds item with standard fields and defaults", () => {
      const testDir = scratchRoot(import.meta.path, "add-standard");
      const queueFile = join(testDir, "feedback-queue.jsonl");

      const result = todoAddCommand({
        title: "Build unit tests",
        content: "Detailed testing instructions",
        "queue-file": queueFile,
      });

      expect(result.item).toBeDefined();
      expect(result.item.title).toBe("Build unit tests");
      expect(result.item.content).toBe("Detailed testing instructions");
      expect(result.item.priority).toBe("NORMAL");
      expect(result.item.category).toBe("GENERAL");
      expect(result.item.status).toBe("PENDING");
      expect(typeof result.item.id).toBe("string");
      expect(result.markdown).toContain("Mind Queue Item Added");
      expect(result.markdown).toContain("Build unit tests");

      const read = readFeedbackQueue(queueFile);
      expect(read).toHaveLength(1);
      expect(read[0]?.id).toBe(result.item.id);
    });

    it("adds item with custom ID, priority aliases, and category aliases", () => {
      const testDir = scratchRoot(import.meta.path, "add-aliases");
      const queueFile = join(testDir, "feedback-queue.jsonl");

      const res1 = mindQueueAddCommand({
        id: "custom-item-1",
        title: "Critical Fix",
        content: "Fix memory leak",
        priority: "CRITICAL",
        category: "CORE_ENGINE",
        "queue-file": queueFile,
      });
      expect(res1.item.id).toBe("custom-item-1");
      expect(res1.item.priority).toBe("CRITICAL_USER_FEEDBACK");
      expect(res1.item.category).toBe("CORE_ENGINE");

      const res2 = todoAddCommand({
        id: "custom-item-2",
        title: "High Feature",
        content: "Add new subcommand",
        priority: "HIGH",
        category: "CLI_TOOLING",
        "queue-file": queueFile,
      });
      expect(res2.item.id).toBe("custom-item-2");
      expect(res2.item.priority).toBe("HIGH_ARCHITECTURAL_FEATURE");
      expect(res2.item.category).toBe("CLI_TOOLING");

      const res3 = todoAddCommand({
        id: "custom-item-3",
        title: "Directive Task",
        content: "User requested task",
        priority: "DIRECTIVE",
        category: "ARCHITECTURE",
        "queue-file": queueFile,
      });
      expect(res3.item.priority).toBe("USER_DIRECTIVE");
      expect(res3.item.category).toBe("ARCHITECTURE");

      const res4 = todoAddCommand({
        id: "custom-item-4",
        title: "Medium Doc",
        content: "Update README",
        priority: "MEDIUM",
        category: "DOCUMENTATION",
        "queue-file": queueFile,
      });
      expect(res4.item.priority).toBe("NORMAL");
      expect(res4.item.category).toBe("DOCUMENTATION");

      const res5 = todoAddCommand({
        id: "custom-item-5",
        title: "Low Watchdog",
        content: "Tune heartbeat",
        priority: "LOW",
        category: "WATCHDOG",
        "queue-file": queueFile,
      });
      expect(res5.item.priority).toBe("LOW");
      expect(res5.item.category).toBe("WATCHDOG");

      const res6 = todoAddCommand({
        id: "custom-item-6",
        title: "Scaling Task",
        content: "Improve fan-out",
        priority: "UNKNOWN_PRIORITY",
        category: "SCALING",
        "queue-file": queueFile,
      });
      expect(res6.item.priority).toBe("NORMAL");
      expect(res6.item.category).toBe("SCALING");

      const res7 = todoAddCommand({
        id: "custom-item-7",
        title: "Repair Task",
        content: "Lane repair",
        category: "REPAIR",
        "queue-file": queueFile,
      });
      expect(res7.item.category).toBe("REPAIR");

      const res8 = todoAddCommand({
        id: "custom-item-8",
        title: "Contract Task",
        description: "Passed description instead of content",
        category: "AGENT_CONTRACTS",
        "queue-file": queueFile,
      });
      expect(res8.item.content).toBe("Passed description instead of content");
      expect(res8.item.category).toBe("AGENT_CONTRACTS");
    });

    it("throws error on missing required flags", () => {
      const testDir = scratchRoot(import.meta.path, "add-missing-flags");
      const queueFile = join(testDir, "feedback-queue.jsonl");

      expect(() => {
        todoAddCommand({ content: "Missing title", "queue-file": queueFile });
      }).toThrow();

      expect(() => {
        todoAddCommand({ title: "Missing content", "queue-file": queueFile });
      }).toThrow();
    });
  });

  describe("todoListCommand and mindQueueListCommand", () => {
    it("handles empty queue gracefully", () => {
      const testDir = scratchRoot(import.meta.path, "list-empty");
      const queueFile = join(testDir, "feedback-queue.jsonl");

      const result = todoListCommand({ "queue-file": queueFile });
      expect(result.count).toBe(0);
      expect(result.total).toBe(0);
      expect(result.filteredCount).toBe(0);
      expect(result.items).toEqual([]);
      expect(result.stats.total).toBe(0);
      expect(result.markdown).toContain("Mind Queue / To-Do Intake");
      expect(result.markdown).toContain("No items matching the current filter.");
    });

    it("lists items and applies status, category, and priority filters", () => {
      const testDir = scratchRoot(import.meta.path, "list-filtering");
      const queueFile = join(testDir, "feedback-queue.jsonl");

      const sampleItems: FeedbackItem[] = [
        {
          id: "item-1",
          timestamp: "2026-08-22T00:00:00.000Z",
          priority: "CRITICAL_USER_FEEDBACK",
          status: "PENDING",
          category: "CORE_ENGINE",
          title: "Critical Engine Task",
          content: "Fix memory leak in core engine",
        },
        {
          id: "item-2",
          timestamp: "2026-08-22T00:01:00.000Z",
          priority: "HIGH_ARCHITECTURAL_FEATURE",
          status: "ADMITTED",
          category: "ARCHITECTURE",
          title: "Architecture Refactor",
          content: "Refactor DAG subsystem",
        },
        {
          id: "item-3",
          timestamp: "2026-08-22T00:02:00.000Z",
          priority: "NORMAL",
          status: "COMPLETED",
          category: "CLI_TOOLING",
          title: "Very Long Title That Exceeds Forty Characters To Verify Truncation",
          content: "Clean up CLI subcommands",
        },
        {
          id: "item-4",
          timestamp: "2026-08-22T00:03:00.000Z",
          priority: "LOW",
          status: "PENDING",
          category: "DOCUMENTATION",
          title: "Doc Polish",
          content: "Polish markdown docs",
        },
      ];

      writeFeedbackQueue(sampleItems, queueFile);

      // Unfiltered
      const allRes = todoListCommand({ "queue-file": queueFile });
      expect(allRes.total).toBe(4);
      expect(allRes.count).toBe(4);
      expect(allRes.markdown).toContain("Very Long Title That Exceeds Forty Ch...");

      // Status filter
      const pendingRes = todoListCommand({
        status: "PENDING",
        "queue-file": queueFile,
      });
      expect(pendingRes.count).toBe(2);
      expect(pendingRes.items.every((i) => i.status === "PENDING")).toBe(true);

      // Category filter
      const archRes = mindQueueListCommand({
        category: "ARCHITECTURE",
        "queue-file": queueFile,
      });
      expect(archRes.count).toBe(1);
      expect(archRes.items[0]?.id).toBe("item-2");

      // Priority filter
      const critRes = todoListCommand({
        priority: "CRITICAL_USER_FEEDBACK",
        "queue-file": queueFile,
      });
      expect(critRes.count).toBe(1);
      expect(critRes.items[0]?.id).toBe("item-1");

      // --all flag and --limit flag
      const limitRes = todoListCommand({
        limit: "2",
        "queue-file": queueFile,
      });
      expect(limitRes.count).toBe(2);
      expect(limitRes.total).toBe(4);
      expect(limitRes.filteredCount).toBe(4);

      const allFlagRes = todoListCommand({
        all: true,
        limit: "1", // --all supersedes limit
        "queue-file": queueFile,
      });
      expect(allFlagRes.count).toBe(4);
    });
  });

  describe("todoDrainCommand and mindQueueDrainCommand", () => {
    it("handles drain on empty queue", () => {
      const testDir = scratchRoot(import.meta.path, "drain-empty");
      const queueFile = join(testDir, "feedback-queue.jsonl");

      const result = todoDrainCommand({ "queue-file": queueFile });
      expect(result.drainedCount).toBe(0);
      expect(result.items).toEqual([]);
      expect(result.item).toBeUndefined();
      expect(result.markdown).toContain("Mind Queue Drain: Empty");
    });

    it("drains items with FIFO priority ordering, custom mark-as, and category/priority filters", () => {
      const testDir = scratchRoot(import.meta.path, "drain-filters");
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
      const testDir = scratchRoot(import.meta.path, "seal-standard");
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
        "test-path": "tests/unit/cli/todo-ops.test.ts",
        assertions: "15",
        "runtime-ms": "42",
        "queue-file": queueFile,
      });

      expect(sealRes.sealed).toBe(true);
      expect(sealRes.item.id).toBe("seal-target");
      expect(sealRes.item.status).toBe("COMPLETED");
      expect(sealRes.item.commit_sha).toBe("a1b2c3d4e5f6");
      expect(sealRes.item.test_path).toBe("tests/unit/cli/todo-ops.test.ts");
      expect(sealRes.item.assertions).toBe(15);
      expect(sealRes.item.runtime_ms).toBe(42);
      expect(sealRes.item.resolution_note).toBe("Successfully implemented and unit tested");
      expect(sealRes.markdown).toContain("Mind Queue Item Sealed");
      expect(sealRes.markdown).toContain("a1b2c3d4e5f6");
      expect(sealRes.markdown).toContain("tests/unit/cli/todo-ops.test.ts");

      const read = readFeedbackQueue(queueFile);
      expect(read[0]?.status).toBe("COMPLETED");
      expect(read[0]?.resolution?.commit_sha).toBe("a1b2c3d4e5f6");
    });

    it("seals item with note/summary fallback and enforces empirical constraints", () => {
      const testDir = scratchRoot(import.meta.path, "seal-constraints");
      const queueFile = join(testDir, "feedback-queue.jsonl");

      todoAddCommand({
        id: "seal-target-2",
        title: "Feature 2",
        content: "Details",
        "queue-file": queueFile,
      });

      // Using summary fallback
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

      // Enforcing require-commit-sha when commit is missing
      expect(() => {
        todoSealCommand({
          id: "seal-target-3",
          resolution: "Fix done",
          "require-commit-sha": true,
          "queue-file": queueFile,
        });
      }).toThrow();

      // Enforcing require-test-path when test-path is missing
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
      const testDir = scratchRoot(import.meta.path, "seal-nonexistent");
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

  describe("todoCleanCommand and mindQueueCleanCommand", () => {
    it("rejects the direct completed-file alias before mutating canonical or outside files", () => {
      const testDir = scratchRoot(import.meta.path, "clean-reject-completed-file-alias");
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
      writeFileSync(canonicalArchiveFile, "canonical archive sentinel\\n", "utf-8");
      writeFileSync(outsideSentinelFile, "outside sentinel\\n", "utf-8");

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
      const testDir = scratchRoot(import.meta.path, "todo-clean-concurrent-add");
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
      const testDir = scratchRoot(import.meta.path, "clean-noop");
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
      const testDir = scratchRoot(import.meta.path, "clean-dryrun");
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

      // Files should NOT be changed
      const queueItems = readFeedbackQueue(queueFile);
      expect(queueItems).toHaveLength(1);
      const ledgerItems = readCompletedTasksLedger(archiveFile);
      expect(ledgerItems).toHaveLength(0);
    });

    it("prunes and archives completed and declined items to ledger file", () => {
      const testDir = scratchRoot(import.meta.path, "clean-archive");
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
        "test-path": "tests/unit/test.test.ts",
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

      // Active queue contains only item 3
      const remainingQueue = readFeedbackQueue(queueFile);
      expect(remainingQueue).toHaveLength(1);
      expect(remainingQueue[0]?.id).toBe("clean-task-3");

      // Archive ledger contains item 1 and item 2
      const ledger = readCompletedTasksLedger(archiveFile);
      expect(ledger).toHaveLength(2);
      const archived1 = ledger.find((r) => r.id === "clean-task-1");
      expect(archived1?.status).toBe("COMPLETED");
      expect(archived1?.commit_sha).toBe("fedcba987654");
      expect(archived1?.test_path).toBe("tests/unit/test.test.ts");
      expect(archived1?.assertions).toBe(12);
      expect(archived1?.runtime_ms).toBe(80);

      const archived2 = ledger.find((r) => r.id === "clean-task-2");
      expect(archived2?.status).toBe("RESOLVED");
    });
  });

  describe("execute CLI harness integration for mind:queue:* and todo:* commands", () => {
    it("executes mind:queue:add, todo:list, todo:drain, mind:queue:seal, and todo:clean via CLI execute harness", async () => {
      const testDir = scratchRoot(import.meta.path, "cli-execute-harness");
      const authorityRun = authorizeMind(testDir);
      const queueFile = join(testDir, "feedback-queue.jsonl");
      const archiveFile = join(testDir, "completed-tasks.jsonl");

      // 1. mind:queue:add
      const addRes = await execute([
        "mind:queue:add",
        "--title",
        "Harness Dispatched Item",
        "--content",
        "Dispatched via CLI execute",
        "--priority",
        "CRITICAL",
        "--category",
        "CORE_ENGINE",
        "--queue-file",
        queueFile,
      ]);
      expect(addRes["item"]).toBeDefined();
      const addedItem = addRes["item"] as FeedbackItem;
      expect(addedItem.title).toBe("Harness Dispatched Item");
      expect(addedItem.priority).toBe("CRITICAL_USER_FEEDBACK");

      // 2. todo:list
      const listRes = await execute([
        "todo:list",
        "--status",
        "PENDING",
        "--all",
        "--queue-file",
        queueFile,
      ]);
      expect(listRes["count"]).toBe(1);
      expect(listRes["total"]).toBe(1);

      // 3. todo:drain
      const drainRes = await execute([
        "todo:drain",
        "--authority-run",
        authorityRun,
        "--limit",
        "1",
        "--mark-as",
        "PROCESSED",
        "--queue-file",
        queueFile,
      ]);
      expect(drainRes["drainedCount"]).toBe(1);

      // 4. mind:queue:seal
      const sealRes = await execute([
        "mind:queue:seal",
        "--authority-run",
        authorityRun,
        "--id",
        addedItem.id,
        "--resolution",
        "Empirical proof verified",
        "--commit",
        "abcdef123456",
        "--test-path",
        "tests/unit/cli/todo-ops.test.ts",
        "--assertions",
        "10",
        "--runtime-ms",
        "50",
        "--queue-file",
        queueFile,
      ]);
      expect(sealRes["sealed"]).toBe(true);

      // 5. todo:clean
      const cleanRes = await execute([
        "todo:clean",
        "--authority-run",
        authorityRun,
        "--queue-file",
        queueFile,
        "--archive-file",
        archiveFile,
      ]);
      expect(cleanRes["cleanedCount"]).toBe(1);
      expect(cleanRes["remainingCount"]).toBe(0);

      // 6. todo:list shows 0 items remaining
      const listEmpty = await execute(["mind:queue:list", "--queue-file", queueFile]);
      expect(listEmpty["count"]).toBe(0);
    });

    it("handles alias feedback:list, feedback:ingest, feedback:drain through execute", async () => {
      const testDir = scratchRoot(import.meta.path, "cli-aliases");
      const authorityRun = authorizeMind(testDir);
      const queueFile = join(testDir, "feedback-queue.jsonl");

      const addRes = await execute([
        "feedback:ingest",
        "--title",
        "Alias Ingest Test",
        "--content",
        "Alias content",
        "--queue-file",
        queueFile,
      ]);
      expect(addRes["item"]).toBeDefined();

      const listRes = await execute(["feedback:list", "--queue-file", queueFile]);
      expect(listRes["count"]).toBe(1);

      const drainRes = await execute([
        "feedback:drain",
        "--authority-run",
        authorityRun,
        "--queue-file",
        queueFile,
      ]);
      expect(drainRes["drainedCount"]).toBe(1);
    });
  });
});

describe("Static Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
  it("verifies CLI todo-ops test files contain zero any and zero suppressions", () => {
    const filesToAudit = [
      join(process.cwd(), "olt/scripts/src/cli/commands/todo-ops.ts"),
      join(process.cwd(), "olt/scripts/src/cli/registry/todo.ts"),
      join(process.cwd(), "tests/unit/cli/todo-ops.test.ts"),
    ];

    const anyPattern = new RegExp(":\\s*any\\b|as\\s+any\\b|<any>");
    const suppressionPattern = new RegExp(
      [
        "@ts" + "-ignore",
        "@ts" + "-expect-error",
        "@ts" + "-nocheck",
        "eslint" + "-disable",
        "oxlint" + "-disable",
      ].join("|"),
    );

    for (const filePath of filesToAudit) {
      if (!existsSync(filePath)) continue;
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (line.includes("anyPattern") || line.includes("suppressionPattern")) continue;

        expect(anyPattern.test(line)).toBe(false);
        expect(suppressionPattern.test(line)).toBe(false);
      }
    }
  });
});
