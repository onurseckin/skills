import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  assertValidActiveLease,
  assertWriteScopeASTPurity,
  claimTaskLease,
  completeTask,
  enqueueTask,
  enqueueTasksBatch,
  failTask,
  readTaskQueue,
  stageWorktreeProgress,
  translateSuspendedLeases,
  validateCompletionReceipts,
  type TaskQueueItem,
} from "../../../olt/scripts/src/task/queue/index.ts";

describe("Task Queue Transitions Engine", () => {
  const testDir = mkdtempSync(join(tmpdir(), "test-transitions-"));
  const queuePath = join(testDir, "TASK_QUEUE.jsonl");

  beforeEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
    execSync("git init", { cwd: testDir, stdio: "ignore" });
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  test("completeTask completes an active task with valid lease and receipts", () => {
    enqueueTask(
      {
        id: "task-comp-1",
        title: "Completion Test",
        write_scope: ["src/comp.ts"],
        gate: "bun test",
      },
      queuePath,
    );

    const claim = claimTaskLease({
      taskId: "task-comp-1",
      agentId: "agent-1",
      customPath: queuePath,
    });

    const result = completeTask({
      taskId: "task-comp-1",
      agentId: "agent-1",
      leaseToken: claim.leaseToken,
      receipts: { exit_code: 0, cognitive_verdict: "PASS" },
      customPath: queuePath,
    });

    expect(result.completedTask.status).toBe("COMPLETED");
    expect(result.completedTask.lease).toBeNull();
    expect(result.completedTask.completed_at).toBeDefined();

    const items = readTaskQueue(queuePath);
    expect(items[0]!.status).toBe("COMPLETED");
  });

  test("completeTask supports positional signature and unblocks dependents", () => {
    enqueueTasksBatch(
      [
        {
          id: "task-pos-parent",
          title: "Parent",
          write_scope: ["src/parent.ts"],
          gate: "bun test",
        },
        {
          id: "task-pos-child",
          title: "Child",
          write_scope: ["src/child.ts"],
          gate: "bun test",
          dependencies: ["task-pos-parent"],
        },
      ],
      queuePath,
    );

    const claim = claimTaskLease({
      taskId: "task-pos-parent",
      agentId: "agent-pos",
      customPath: queuePath,
    });

    const result = completeTask(
      "task-pos-parent",
      claim.leaseToken,
      { exit_code: 0, cognitive_verdict: "PASS" },
      queuePath,
    );

    expect(result.completedTask.id).toBe("task-pos-parent");
    expect(result.unblockedTasks.length).toBe(1);
    expect(result.unblockedTasks[0]!.id).toBe("task-pos-child");
    expect(result.unblockedTasks[0]!.status).toBe("PENDING");
  });

  test("completeTask rejects invalid receipts and mismatched lease token", () => {
    enqueueTask(
      {
        id: "task-bad-receipt",
        title: "Bad Receipt Test",
        write_scope: ["src/bad.ts"],
        gate: "bun test",
      },
      queuePath,
    );

    const claim = claimTaskLease({
      taskId: "task-bad-receipt",
      agentId: "agent-1",
      customPath: queuePath,
    });

    expect(() =>
      completeTask({
        taskId: "task-bad-receipt",
        leaseToken: "wrong-token",
        customPath: queuePath,
      }),
    ).toThrow(HarnessError);

    expect(() =>
      completeTask({
        taskId: "task-bad-receipt",
        leaseToken: claim.leaseToken,
        receipts: { exit_code: 1, cognitive_verdict: "PASS" },
        customPath: queuePath,
      }),
    ).toThrow(HarnessError);

    expect(() =>
      completeTask({
        taskId: "task-bad-receipt",
        leaseToken: claim.leaseToken,
        receipts: { exit_code: 0, cognitive_verdict: "FAIL" },
        customPath: queuePath,
      }),
    ).toThrow(HarnessError);
  });

  test("failTask retries when below max_retries and fails when exhausted", () => {
    enqueueTask(
      {
        id: "task-fail-1",
        title: "Fail Task",
        write_scope: ["src/fail.ts"],
        gate: "bun test",
        max_retries: 1,
      },
      queuePath,
    );

    const res1 = failTask({
      taskId: "task-fail-1",
      errorMessage: "Transient error",
      customPath: queuePath,
    });

    expect(res1.retried).toBe(true);
    expect(res1.task.retry_count).toBe(1);
    expect(res1.task.status).toBe("PENDING");

    const res2 = failTask("task-fail-1", undefined, "Fatal error", false, queuePath);
    expect(res2.retried).toBe(false);
    expect(res2.task.status).toBe("FAILED");
    expect(res2.task.error_message).toBe("Fatal error");
  });

});
