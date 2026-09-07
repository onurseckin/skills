import { afterEach, beforeEach, describe, expect, it } from "bun:test";
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
} from "../../../../../olt/scripts/src/cli/commands/todo/index.ts";
import {
  writeFeedbackQueue,
  type FeedbackItem,
} from "../../../../../olt/scripts/src/mind/feedback/queue/index.ts";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
  getVirtualCliFS,
  setupVirtualCliFS,
} from "../../fixtures/full-lifecycle-fixture.ts";

const roots: string[] = [];
beforeEach(() => setupVirtualCliFS());
afterEach(async () => {
  await cleanupRoots(roots);
  cleanupVirtualCliFS();
});

function getTestDir(lbl: string): string {
  const d = `/virtual/cli/todo-c-${lbl}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  getVirtualCliFS().mkdirSync(d, { recursive: true });
  roots.push(d);
  return d;
}

describe("todo-ops comprehensive suite", () => {
  it("verifies direct aliases match between mindQueue* and todo*", () => {
    expect(mindQueueListCommand).toBe(todoListCommand);
    expect(mindQueueAddCommand).toBe(todoAddCommand);
    expect(mindQueueDrainCommand).toBe(todoDrainCommand);
    expect(mindQueueSealCommand).toBe(todoSealCommand);
    expect(mindQueueCleanCommand).toBe(todoCleanCommand);
  });

  it("todoAddCommand parses all priority & category branches and errors", () => {
    const qFile = join(getTestDir("add-br"), "feedback-queue.jsonl");
    const priorities = [
      ["CRITICAL_USER_FEEDBACK", "CRITICAL_USER_FEEDBACK"],
      ["CRITICAL", "CRITICAL_USER_FEEDBACK"],
      ["HIGH_ARCHITECTURAL_FEATURE", "HIGH_ARCHITECTURAL_FEATURE"],
      ["HIGH", "HIGH_ARCHITECTURAL_FEATURE"],
      ["USER_DIRECTIVE", "USER_DIRECTIVE"],
      ["DIRECTIVE", "USER_DIRECTIVE"],
      ["MEDIUM", "NORMAL"],
      ["NORMAL", "NORMAL"],
      ["LOW", "LOW"],
      ["UNKNOWN", "NORMAL"],
    ] as const;
    priorities.forEach(([r, exp], i) => {
      const itm = todoAddCommand({
        title: `T${i}`,
        content: `C${i}`,
        priority: r,
        "queue-path": qFile,
      }).item;
      expect(itm.priority).toBe(exp);
    });

    const categories = [
      ["DOCUMENTATION", "DOCUMENTATION"],
      ["AGENT_CONTRACTS", "AGENT_CONTRACTS"],
      ["CLI_TOOLING", "CLI_TOOLING"],
      ["WATCHDOG", "WATCHDOG"],
      ["SCALING", "SCALING"],
      ["ARCHITECTURE", "ARCHITECTURE"],
      ["CORE_ENGINE", "CORE_ENGINE"],
      ["REPAIR", "REPAIR"],
      ["OTHER_CAT", "GENERAL"],
    ] as const;
    categories.forEach(([r, exp], i) => {
      const res = todoAddCommand({
        title: `C${i}`,
        description: `D${i}`,
        category: r,
        "queue-file": qFile,
      });
      expect(res.item.category).toBe(exp);
      expect(res.item.content).toBe(`D${i}`);
    });

    const def = todoAddCommand({ title: "Def", content: "Body", "queue-file": qFile });
    expect(def.item.priority).toBe("NORMAL");
    expect(def.item.category).toBe("GENERAL");
    expect(def.markdown).toContain("Mind Queue Item Added");
    expect(() => todoAddCommand({ content: "no title", "queue-file": qFile })).toThrow();
    expect(() => todoAddCommand({ title: "no content", "queue-file": qFile })).toThrow();
  });

  it("todoListCommand handles empty & filtered listings with limits", () => {
    const qFile = join(getTestDir("list-ops"), "feedback-queue.jsonl");
    const emptyRes = todoListCommand({ "queue-file": qFile });
    expect(emptyRes.count).toBe(0);
    expect(emptyRes.markdown).toContain("No items matching the current filter.");

    const items: FeedbackItem[] = [
      {
        id: "i1",
        timestamp: "2026-08-30T00:00:00.000Z",
        priority: "CRITICAL_USER_FEEDBACK",
        status: "PENDING",
        category: "CORE_ENGINE",
        title: "Short Title",
        content: "Body 1",
      },
      {
        id: "i2",
        timestamp: "2026-08-30T00:01:00.000Z",
        priority: "NORMAL",
        status: "COMPLETED",
        category: "DOCUMENTATION",
        title: "Very Long Title That Definitely Exceeds Forty Characters For Truncation",
        content: "Body 2",
      },
    ];
    writeFeedbackQueue(items, qFile);

    const listRes = todoListCommand({ "queue-path": qFile, limit: "10" });
    expect(listRes.count).toBe(2);
    expect(listRes.markdown).toContain("Short Title");
    expect(listRes.markdown).toContain("Very Long Title That Definitely Excee...");
    expect(todoListCommand({ "queue-file": qFile, status: "PENDING" }).count).toBe(1);
    expect(todoListCommand({ "queue-file": qFile, category: "DOCUMENTATION" }).count).toBe(1);
    expect(todoListCommand({ "queue-file": qFile, priority: "CRITICAL_USER_FEEDBACK" }).count).toBe(
      1,
    );
    expect(todoListCommand({ "queue-file": qFile, all: true }).markdown).toContain("(all)");
  });

  it("todoDrainCommand handles empty and filtered drains", () => {
    const qFile = join(getTestDir("drain-ops"), "feedback-queue.jsonl");
    const empty = todoDrainCommand({ "queue-file": qFile });
    expect(empty.drainedCount).toBe(0);
    expect(empty.item).toBeUndefined();
    expect(empty.markdown).toContain("Mind Queue Drain: Empty");

    writeFeedbackQueue(
      [
        {
          id: "d1",
          timestamp: "2026-08-30T00:00:00.000Z",
          priority: "CRITICAL_USER_FEEDBACK",
          status: "PENDING",
          category: "CORE_ENGINE",
          title: "Long Title Exceeding Forty Characters For Drain Truncation Testing",
          content: "B1",
        },
        {
          id: "d2",
          timestamp: "2026-08-30T00:01:00.000Z",
          priority: "LOW",
          status: "PENDING",
          category: "DOCUMENTATION",
          title: "Short Title",
          content: "B2",
        },
      ],
      qFile,
    );

    const drainRes = todoDrainCommand({
      "queue-path": qFile,
      limit: "1",
      "mark-as": "ADMITTED",
      category: "CORE_ENGINE",
      priority: "CRITICAL_USER_FEEDBACK",
    });
    expect(drainRes.drainedCount).toBe(1);
    expect(drainRes.item?.id).toBe("d1");
    expect(drainRes.item?.status).toBe("ADMITTED");
    expect(drainRes.markdown).toContain("Marked As**: `ADMITTED`");
    expect(drainRes.markdown).toContain("Category Filter**: CORE_ENGINE");
    expect(drainRes.markdown).toContain("Priority Filter**: CRITICAL_USER_FEEDBACK");
    expect(drainRes.markdown).toContain("Long Title Exceeding Forty Characters...");

    const defDrain = todoDrainCommand({ "queue-file": qFile });
    expect(defDrain.drainedCount).toBe(1);
    expect(defDrain.item?.id).toBe("d2");
    expect(defDrain.item?.status).toBe("PROCESSED");
  });
});
