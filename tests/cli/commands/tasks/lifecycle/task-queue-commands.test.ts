import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import { cleanupVirtualCliFS, setupVirtualCliFS } from "../../fixtures/full-lifecycle-fixture.ts";
import { scratchRoot } from "../../../../shared/fixtures/scratch-root.ts";

beforeEach(() => {
  setupVirtualCliFS();
});
afterEach(() => {
  cleanupVirtualCliFS();
});

describe("Task queue CLI commands & Cowan Pagination", () => {
  test("task:add enqueues tasks and task:list queries them", async () => {
    const dir = scratchRoot(import.meta.path, "task-add-list");
    const queuePath = join(dir, "task-queue.json");

    const addRes = (await execute([
      "task:add",
      "--task",
      "task-01",
      "--title",
      "First unit task",
      "--description",
      "Implement basic functionality",
      "--priority",
      "HIGH",
      "--gate",
      "bun test",
      "--write-scope",
      "src/feature.ts",
      "--queue-path",
      queuePath,
    ])) as Record<string, unknown>;

    expect(addRes.ok).toBe(true);
    expect(addRes.id).toBe("task-01");

    const listRes = (await execute(["task:list", "--queue-path", queuePath, "--stats"])) as Record<
      string,
      unknown
    >;

    expect(Array.isArray(listRes.tasks)).toBe(true);
    expect(listRes.total).toBe(1);
    expect(listRes.stats).toBeDefined();
  });

  test("task:list handles Cowan pagination with page and limit parameters", async () => {
    const dir = scratchRoot(import.meta.path, "task-list-cowan-pagination");
    const queuePath = join(dir, "task-queue.json");

    for (let i = 1; i <= 10; i += 1) {
      await execute([
        "task:add",
        "--task",
        `task-page-${i}`,
        "--title",
        `Paginated Task ${i}`,
        "--priority",
        i <= 5 ? "CRITICAL" : "LOW",
        "--queue-path",
        queuePath,
      ]);
    }

    const page1Res = (await execute([
      "task:list",
      "--queue-path",
      queuePath,
      "--limit",
      "4",
      "--page",
      "1",
    ])) as Record<string, unknown>;

    expect(page1Res.total).toBe(10);
    expect(page1Res.count).toBe(4);
    expect(page1Res.offset).toBe(0);
    expect(page1Res.limit).toBe(4);
    expect((page1Res.tasks as unknown[]).length).toBe(4);

    const page2Res = (await execute([
      "task:list",
      "--queue-path",
      queuePath,
      "--limit",
      "4",
      "--page",
      "2",
    ])) as Record<string, unknown>;

    expect(page2Res.total).toBe(10);
    expect(page2Res.count).toBe(4);
    expect(page2Res.offset).toBe(4);
    expect(page2Res.limit).toBe(4);
    expect((page2Res.tasks as unknown[]).length).toBe(4);

    const page3Res = (await execute([
      "task:list",
      "--queue-path",
      queuePath,
      "--limit",
      "4",
      "--page",
      "3",
    ])) as Record<string, unknown>;

    expect(page3Res.total).toBe(10);
    expect(page3Res.count).toBe(2);
    expect(page3Res.offset).toBe(8);
    expect(page3Res.limit).toBe(4);
    expect((page3Res.tasks as unknown[]).length).toBe(2);
  });

  test("task:lease claims lease and task:complete finishes task via CLI harness", async () => {
    const dir = scratchRoot(import.meta.path, "task-lease-complete-cli");
    const queuePath = join(dir, "task-queue.json");
    const archivePath = join(dir, "archive.jsonl");

    await execute([
      "task:add",
      "--task",
      "task-dep-parent",
      "--title",
      "Parent Task",
      "--queue-path",
      queuePath,
    ]);

    await execute([
      "task:add",
      "--task",
      "task-dep-child",
      "--title",
      "Child Task",
      "--dependencies",
      "task-dep-parent",
      "--queue-path",
      queuePath,
    ]);

    const leaseRes = (await execute([
      "task:lease",
      "--task",
      "task-dep-parent",
      "--agent-id",
      "worker-agent",
      "--lease-duration",
      "1800",
      "--queue-path",
      queuePath,
    ])) as Record<string, unknown>;

    const token = String(leaseRes.leaseToken ?? leaseRes.token);
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);

    const completeRes = (await execute([
      "task:complete",
      "--task",
      "task-dep-parent",
      "--agent-id",
      "worker-agent",
      "--token",
      token,
      "--proof-summary",
      "Implemented and validated parent task",
      "--auto-archive",
      "--archive-path",
      archivePath,
      "--queue-path",
      queuePath,
    ])) as Record<string, unknown>;

    const taskObj = completeRes.task as Record<string, unknown>;
    expect(taskObj.status).toBe("COMPLETED");

    const listRes = (await execute(["task:list", "--queue-path", queuePath])) as Record<
      string,
      unknown
    >;
    const tasks = listRes.tasks as Array<Record<string, unknown>>;
    const childTask = tasks.find((t) => t.id === "task-dep-child");
    expect(childTask?.status).toBe("PENDING");
    expect(childTask?.blocked_by).toEqual([]);
  });

  test("task:fail records failure and increments retry count", async () => {
    const dir = scratchRoot(import.meta.path, "task-fail-harness");
    const queuePath = join(dir, "task-queue.json");

    await execute([
      "task:add",
      "--task",
      "task-failing",
      "--title",
      "Failing task",
      "--max-retries",
      "3",
      "--queue-path",
      queuePath,
    ]);

    const failRes = (await execute([
      "task:fail",
      "--task",
      "task-failing",
      "--message",
      "Syntax error in AST",
      "--can-retry",
      "--queue-path",
      queuePath,
    ])) as Record<string, unknown>;

    expect(failRes.retried).toBe(true);
    const taskObj = failRes.task as Record<string, unknown>;
    expect(taskObj.retry_count).toBe(1);
  });

  test("task:prune removes completed tasks from the queue", async () => {
    const dir = scratchRoot(import.meta.path, "task-prune-harness");
    const queuePath = join(dir, "task-queue.json");

    await execute([
      "task:add",
      "--task",
      "task-to-prune",
      "--title",
      "Completed task to prune",
      "--queue-path",
      queuePath,
    ]);

    await execute(["task:complete", "--task", "task-to-prune", "--queue-path", queuePath]);

    const pruneRes = (await execute([
      "task:prune",
      "--auto-archive",
      "false",
      "--queue-path",
      queuePath,
    ])) as Record<string, unknown>;

    expect(pruneRes.prunedCount).toBe(1);
    expect(pruneRes.remainingCount).toBe(0);
  });
});
