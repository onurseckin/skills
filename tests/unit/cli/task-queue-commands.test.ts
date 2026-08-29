import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import {
  taskAddCommand,
  taskCompleteCommand,
  taskFailCommand,
  taskLeaseCommand,
  taskListCommand,
  taskPruneCommand,
} from "../../../olt/scripts/src/cli/commands/task-queue-ops.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("Task queue CLI commands", () => {
  test("task:add enqueues tasks and task:list queries them", () => {
    const dir = scratchRoot(import.meta.path, "task-add-list");
    const queuePath = join(dir, "task-queue.json");

    const addRes = taskAddCommand({
      task: "task-01",
      title: "First unit task",
      description: "Implement basic functionality",
      priority: "HIGH",
      gate: "bun test",
      "write-scope": ["src/feature.ts"],
      "queue-path": queuePath,
    });

    expect(addRes.ok).toBe(true);
    expect(addRes.id).toBe("task-01");

    const listRes = taskListCommand({
      "queue-path": queuePath,
      stats: true,
    });

    expect(Array.isArray(listRes.tasks)).toBe(true);
    expect(listRes.total).toBe(1);
    expect(listRes.stats).toBeDefined();
  });

  test("task:lease claims lease and task:complete finishes task", () => {
    const dir = scratchRoot(import.meta.path, "task-lease-complete");
    const queuePath = join(dir, "task-queue.json");

    taskAddCommand({
      task: "task-02",
      title: "Second unit task",
      gate: "bun test",
      "write-scope": ["src/logic.ts"],
      "queue-path": queuePath,
    });

    const leaseRes = taskLeaseCommand({
      task: "task-02",
      "agent-id": "worker-agent",
      "lease-duration": 1800,
      "queue-path": queuePath,
    });

    expect(typeof leaseRes.leaseToken).toBe("string");
    expect(leaseRes.leaseToken.length).toBeGreaterThan(0);

    const completeRes = taskCompleteCommand({
      task: "task-02",
      "agent-id": "worker-agent",
      "lease-token": leaseRes.leaseToken as string,
      "proof-summary": "All tests pass with 100% coverage",
      "queue-path": queuePath,
    });

    const taskObj = completeRes.task as Record<string, unknown>;
    expect(taskObj.status).toBe("COMPLETED");
  });

  test("task:fail records failure and increments retry count", () => {
    const dir = scratchRoot(import.meta.path, "task-fail");
    const queuePath = join(dir, "task-queue.json");

    taskAddCommand({
      task: "task-03",
      title: "Failing task",
      gate: "bun test",
      "write-scope": ["src/fail.ts"],
      "max-retries": 3,
      "queue-path": queuePath,
    });

    const failRes = taskFailCommand({
      task: "task-03",
      message: "Syntax error in AST",
      "can-retry": true,
      "queue-path": queuePath,
    });

    expect(failRes.retried).toBe(true);
    const taskObj = failRes.task as Record<string, unknown>;
    expect(taskObj.retry_count).toBe(1);
  });

  test("task:prune removes completed tasks from the queue", () => {
    const dir = scratchRoot(import.meta.path, "task-prune");
    const queuePath = join(dir, "task-queue.json");

    taskAddCommand({
      task: "task-04",
      title: "Completed task to prune",
      gate: "bun test",
      "write-scope": ["src/prune.ts"],
      "queue-path": queuePath,
    });

    taskCompleteCommand({
      task: "task-04",
      "queue-path": queuePath,
    });

    const pruneRes = taskPruneCommand({
      "auto-archive": false,
      "queue-path": queuePath,
    });

    expect(pruneRes.prunedCount).toBe(1);
    expect(pruneRes.remainingCount).toBe(0);
  });

  test("CLI execute dispatches task commands through registry", async () => {
    const dir = scratchRoot(import.meta.path, "task-cli-exec");
    const queuePath = join(dir, "task-queue.json");

    const addResult = await execute([
      "task:add",
      "--task",
      "cli-task-1",
      "--title",
      "CLI Task Title",
      "--queue-path",
      queuePath,
    ]);
    expect(addResult.id).toBe("cli-task-1");

    const listResult = await execute(["task:list", "--queue-path", queuePath]);
    expect(listResult.total).toBe(1);

    const leaseResult = await execute([
      "task:lease",
      "--task",
      "cli-task-1",
      "--agent-id",
      "cli-worker",
      "--queue-path",
      queuePath,
    ]);
    expect(leaseResult.leaseToken).toBeDefined();

    const completeResult = await execute([
      "task:complete",
      "--task",
      "cli-task-1",
      "--queue-path",
      queuePath,
    ]);
    const taskData = completeResult.task as Record<string, unknown>;
    expect(taskData.status).toBe("COMPLETED");

    const pruneResult = await execute(["task:prune", "--queue-path", queuePath]);
    expect(pruneResult.prunedCount).toBe(1);
  });
});
