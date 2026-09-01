import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  executeTaskComplete,
  executeTaskLease,
  executeTaskList,
  taskAddCommand,
  taskLeaseCommand,
  taskListCommand,
} from "../../../../../olt/scripts/src/cli/commands/task-queue-ops.ts";
import { cleanupVirtualCliFS, setupVirtualCliFS } from "../../fixtures/full-lifecycle-fixture.ts";

const roots: string[] = [];

async function createVirtualDir(prefix: string): Promise<string> {
  const dir = `/virtual/cli/${prefix}-${Math.random().toString(36).slice(2)}`;
  roots.push(dir);
  await mkdir(dir, { recursive: true });
  return dir;
}

describe("Task CLI Queue Listing & Querying", () => {
  beforeEach(() => {
    setupVirtualCliFS();
  });

  afterEach(() => {
    cleanupVirtualCliFS();
    roots.length = 0;
  });

  test("executeTaskList queries tasks with Cowan pagination and returns exit code 0", async () => {
    const dir = await createVirtualDir("cli-task-list-cowan");
    const queuePath = join(dir, "task-queue.json");
    for (let i = 1; i <= 5; i += 1) {
      taskAddCommand({
        task: `task-item-0${i}`,
        title: `Task item ${i}`,
        description: `Description ${i}`,
        priority: i % 2 === 0 ? "HIGH" : "MEDIUM",
        gate: "bun test",
        "queue-path": queuePath,
      });
    }
    const exitCodeDefault = await executeTaskList(["task:list", "--queue-path", queuePath]);
    expect(exitCodeDefault).toBe(0);
    const paginatedRes = taskListCommand({ "queue-path": queuePath, limit: 2, page: 2 });
    expect(paginatedRes.total).toBe(5);
    expect(paginatedRes.count).toBe(2);
    expect(paginatedRes.offset).toBe(2);
    expect(paginatedRes.limit).toBe(2);
    const tasks = paginatedRes.tasks as Array<Record<string, unknown>>;
    expect(tasks.length).toBe(2);
  });

  test("executeTaskList filters tasks by priority and search keyword", async () => {
    const dir = await createVirtualDir("cli-task-list-filters");
    const queuePath = join(dir, "task-queue.json");
    taskAddCommand({
      task: "task-parser",
      title: "Parser module",
      description: "AST parse engine",
      priority: "CRITICAL",
      gate: "bun test",
      "queue-path": queuePath,
    });
    taskAddCommand({
      task: "task-docs",
      title: "Documentation module",
      description: "Update markdown docs",
      priority: "LOW",
      gate: "bun test",
      "queue-path": queuePath,
    });
    const filterResult = taskListCommand({ "queue-path": queuePath, priority: "CRITICAL" });
    const criticalTasks = filterResult.tasks as Array<Record<string, unknown>>;
    expect(criticalTasks.length).toBe(1);
    expect(criticalTasks[0]?.id).toBe("task-parser");
    const searchResult = taskListCommand({ "queue-path": queuePath, search: "docs" });
    const searchTasks = searchResult.tasks as Array<Record<string, unknown>>;
    expect(searchTasks.length).toBe(1);
    expect(searchTasks[0]?.id).toBe("task-docs");
  });

  test("executeTaskList returns exit code 2 on invalid flag argument", async () => {
    const dir = await createVirtualDir("cli-task-list-invalid");
    const queuePath = join(dir, "task-queue.json");
    const exitCode = await executeTaskList([
      "task:list",
      "--bogus-argument",
      "xyz",
      "--queue-path",
      queuePath,
    ]);
    expect(exitCode).toBe(2);
  });
});

describe("Task CLI Lease and Complete Operations (task-cli-05)", () => {
  beforeEach(() => {
    setupVirtualCliFS();
  });

  afterEach(() => {
    cleanupVirtualCliFS();
    roots.length = 0;
  });

  test("executeTaskLease acquires lease token and executeTaskComplete finalizes task", async () => {
    const dir = await createVirtualDir("cli-task-lease-complete");
    const queuePath = join(dir, "task-queue.json");
    const archivePath = join(dir, "completed.jsonl");

    taskAddCommand({
      task: "task-pipe-1",
      title: "Pipeline task 1",
      gate: "bun test",
      "queue-path": queuePath,
    });
    taskAddCommand({
      task: "task-pipe-2",
      title: "Pipeline task 2",
      dependencies: ["task-pipe-1"],
      gate: "bun test",
      "queue-path": queuePath,
    });

    const leaseRes = taskLeaseCommand({
      task: "task-pipe-1",
      "agent-id": "worker-agent",
      "lease-duration": 1800,
      "queue-path": queuePath,
    });
    const token = String(leaseRes.token ?? leaseRes.leaseToken);
    expect(typeof token).toBe("string");
    expect(token.startsWith("lease-")).toBe(true);

    const completeExit = await executeTaskComplete([
      "task:complete",
      "--task",
      "task-pipe-1",
      "--agent-id",
      "worker-agent",
      "--token",
      token,
      "--proof-summary",
      "All unit tests pass",
      "--auto-archive",
      "--archive-path",
      archivePath,
      "--queue-path",
      queuePath,
    ]);
    expect(completeExit).toBe(0);

    const listRes = taskListCommand({ "queue-path": queuePath });
    const tasks = listRes.tasks as Array<Record<string, unknown>>;
    const task1 = tasks.find((t) => t.id === "task-pipe-1");
    const task2 = tasks.find((t) => t.id === "task-pipe-2");
    expect(task1?.status).toBe("COMPLETED");
    expect(task2?.status).toBe("PENDING");
    expect(task2?.blocked_by).toEqual([]);
  });

  test("executeTaskLease CLI verb executes successfully", async () => {
    const dir = await createVirtualDir("cli-task-lease-exec");
    const queuePath = join(dir, "task-queue.json");

    taskAddCommand({
      task: "task-lease-test",
      title: "Lease test task",
      gate: "bun test",
      "queue-path": queuePath,
    });

    const exitCode = await executeTaskLease([
      "task:lease",
      "--task",
      "task-lease-test",
      "--agent-id",
      "agent-1",
      "--queue-path",
      queuePath,
    ]);
    expect(exitCode).toBe(0);
  });

  test("executeTaskLease returns exit code 2 on invalid flag", async () => {
    const dir = await createVirtualDir("cli-task-lease-invalid");
    const queuePath = join(dir, "task-queue.json");
    const exitCode = await executeTaskLease([
      "task:lease",
      "--bad-option",
      "val",
      "--queue-path",
      queuePath,
    ]);
    expect(exitCode).toBe(2);
  });

  test("executeTaskComplete returns exit code 2 on invalid flag", async () => {
    const dir = await createVirtualDir("cli-task-complete-invalid");
    const queuePath = join(dir, "task-queue.json");
    const exitCode = await executeTaskComplete([
      "task:complete",
      "--unknown-flag",
      "val",
      "--queue-path",
      queuePath,
    ]);
    expect(exitCode).toBe(2);
  });
});
