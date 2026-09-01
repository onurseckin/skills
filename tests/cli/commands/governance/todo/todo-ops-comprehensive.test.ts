import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync } from "node:fs";
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
} from "../../../../../olt/scripts/src/cli/commands/todo-ops.ts";
import {
  readFeedbackQueue,
  writeFeedbackQueue,
  type FeedbackItem,
} from "../../../../../olt/scripts/src/mind/feedback/queue/index.ts";
import { readCompletedTasksLedger } from "../../../../../olt/scripts/src/mind/archival/completed/index.ts";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
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
  mkdirSync(d, { recursive: true });
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

  it("todoSealCommand seals items with proof and enforces requirements", () => {
    const qFile = join(getTestDir("seal-ops"), "feedback-queue.jsonl");
    todoAddCommand({ id: "s1", title: "Task 1", content: "Content", "queue-file": qFile });
    todoAddCommand({ id: "s2", title: "Task 2", content: "Content", "queue-file": qFile });
    todoAddCommand({ id: "s3", title: "Task 3", content: "Content", "queue-file": qFile });

    const seal1 = todoSealCommand({
      id: "s1",
      resolution: "Fixed issue",
      commit: "abc1234",
      "test-path": "tests/test.ts",
      assertions: "5",
      "runtime-ms": "12",
      "queue-path": qFile,
    });
    expect(seal1.sealed).toBe(true);
    expect(seal1.item.commit_sha).toBe("abc1234");
    expect(seal1.item.test_path).toBe("tests/test.ts");
    expect(seal1.item.assertions).toBe(5);
    expect(seal1.item.runtime_ms).toBe(12);
    expect(seal1.markdown).toContain("Mind Queue Item Sealed");

    const seal2 = todoSealCommand({
      id: "s2",
      note: "Note res",
      "commit-sha": "def5678",
      "queue-file": qFile,
    });
    expect(seal2.item.resolution_note).toBe("Note res");

    const seal3 = todoSealCommand({ id: "s3", summary: "Summary res", "queue-file": qFile });
    expect(seal3.item.resolution_note).toBe("Summary res");

    expect(() =>
      todoSealCommand({
        id: "s3",
        resolution: "Fail commit",
        "require-commit-sha": true,
        "queue-file": qFile,
      }),
    ).toThrow();
    expect(() =>
      todoSealCommand({
        id: "s3",
        resolution: "Fail test-path",
        commit: "12345",
        "require-test-path": true,
        "queue-file": qFile,
      }),
    ).toThrow();
  });

  it("todoCleanCommand handles dry-run and commits archived records", () => {
    const qFile = join(getTestDir("clean-ops"), "feedback-queue.jsonl");
    const aFile = join(getTestDir("clean-arch"), "completed-tasks.jsonl");

    const emptyClean = todoCleanCommand({ "queue-file": qFile, "archive-file": aFile });
    expect(emptyClean.cleanedCount).toBe(0);
    expect(emptyClean.remainingCount).toBe(0);

    todoAddCommand({
      id: "t1",
      title: "Very Long Clean Title Exceeding Thirty-Five Characters",
      content: "C1",
      category: "CLI_TOOLING",
      "queue-file": qFile,
    });
    todoAddCommand({
      id: "t2",
      title: "Declined Item",
      content: "C2",
      category: "CORE_ENGINE",
      "queue-file": qFile,
    });
    todoAddCommand({
      id: "t3",
      title: "Pending Item",
      content: "C3",
      category: "ARCHITECTURE",
      "queue-file": qFile,
    });

    todoSealCommand({
      id: "t1",
      resolution: "Resolved t1",
      commit: "hash123",
      "test-path": "tests/t1.test.ts",
      assertions: "3",
      "runtime-ms": "50",
      "queue-file": qFile,
    });
    todoDrainCommand({ category: "CORE_ENGINE", "mark-as": "DECLINED", "queue-file": qFile });

    const dryRes = todoCleanCommand({
      "queue-file": qFile,
      "archive-file": aFile,
      "dry-run": true,
    });
    expect(dryRes.dryRun).toBe(true);
    expect(dryRes.cleanedCount).toBe(2);
    expect(dryRes.remainingCount).toBe(1);
    expect(dryRes.markdown).toContain("DRY RUN (no changes written)");
    expect(readFeedbackQueue(qFile)).toHaveLength(3);

    const commitRes = todoCleanCommand({ "queue-path": qFile, "archive-file": aFile });
    expect(commitRes.dryRun).toBe(false);
    expect(commitRes.cleanedCount).toBe(2);
    expect(commitRes.remainingCount).toBe(1);
    expect(commitRes.markdown).toContain("COMMITTED");
    expect(readFeedbackQueue(qFile)).toHaveLength(1);

    const ledger = readCompletedTasksLedger(aFile);
    expect(ledger).toHaveLength(2);
    const archived1 = ledger.find((r) => r.id === "t1");
    expect(archived1?.status).toBe("COMPLETED");
    expect(archived1?.commit_sha).toBe("hash123");
    expect(archived1?.test_path).toBe("tests/t1.test.ts");
    expect(archived1?.assertions).toBe(3);
    expect(archived1?.runtime_ms).toBe(50);
    expect(ledger.find((r) => r.id === "t2")?.status).toBe("RESOLVED");
  });
});
