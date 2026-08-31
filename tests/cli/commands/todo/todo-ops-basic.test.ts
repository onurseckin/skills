import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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
  const dir = mkdtempSync(join(tmpdir(), `todo-basic-${label}-`));
  roots.push(dir);
  return dir;
}

describe("CLI todo-ops and mind:queue commands - Add & List", () => {
  it("verifies direct function aliases match between mindQueue* and todo*", () => {
    expect(mindQueueListCommand).toBe(todoListCommand);
    expect(mindQueueAddCommand).toBe(todoAddCommand);
    expect(mindQueueDrainCommand).toBe(todoDrainCommand);
    expect(mindQueueSealCommand).toBe(todoSealCommand);
    expect(mindQueueCleanCommand).toBe(todoCleanCommand);
  });

  describe("todoAddCommand and mindQueueAddCommand", () => {
    it("adds item with standard fields and defaults", () => {
      const testDir = getTestDir("add-standard");
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
      const testDir = getTestDir("add-aliases");
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
      const testDir = getTestDir("add-missing-flags");
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
      const testDir = getTestDir("list-empty");
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
      const testDir = getTestDir("list-filtering");
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

      const allRes = todoListCommand({ "queue-file": queueFile });
      expect(allRes.total).toBe(4);
      expect(allRes.count).toBe(4);
      expect(allRes.markdown).toContain("Very Long Title That Exceeds Forty Ch...");

      const pendingRes = todoListCommand({
        status: "PENDING",
        "queue-file": queueFile,
      });
      expect(pendingRes.count).toBe(2);
      expect(pendingRes.items.every((i) => i.status === "PENDING")).toBe(true);

      const archRes = mindQueueListCommand({
        category: "ARCHITECTURE",
        "queue-file": queueFile,
      });
      expect(archRes.count).toBe(1);
      expect(archRes.items[0]?.id).toBe("item-2");

      const critRes = todoListCommand({
        priority: "CRITICAL_USER_FEEDBACK",
        "queue-file": queueFile,
      });
      expect(critRes.count).toBe(1);
      expect(critRes.items[0]?.id).toBe("item-1");

      const limitRes = todoListCommand({
        limit: "2",
        "queue-file": queueFile,
      });
      expect(limitRes.count).toBe(2);
      expect(limitRes.total).toBe(4);
      expect(limitRes.filteredCount).toBe(4);

      const allFlagRes = todoListCommand({
        all: true,
        limit: "1",
        "queue-file": queueFile,
      });
      expect(allFlagRes.count).toBe(4);
    });
  });
});
