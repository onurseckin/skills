import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
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
} from "../../../../olt/scripts/src/task/queue/index.ts";
import { scratchRoot } from "../../../support/scratch-root.ts";

describe("Task Queue Transitions Engine", () => {
  const testDir = scratchRoot(import.meta.path, "test-transitions");
  const queuePath = join(testDir, "TASK_QUEUE.jsonl");

  beforeEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
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

  test("failTask supports escalateOnMaxRetries", () => {
    enqueueTask(
      {
        id: "task-esc-test",
        title: "Escalate Task",
        write_scope: ["src/esc.ts"],
        gate: "bun test",
        max_retries: 0,
      },
      queuePath,
    );

    const res = failTask({
      taskId: "task-esc-test",
      errorMessage: "Critical failure",
      escalateOnMaxRetries: true,
      customPath: queuePath,
    });

    expect(res.escalated).toBe(true);
    expect(res.task.status).toBe("ESCALATED");
  });

  test("assertValidActiveLease validates lease correctly", () => {
    const validTask: TaskQueueItem = {
      id: "t1",
      title: "T1",
      description: "",
      priority: "HIGH",
      status: "IN_PROGRESS",
      write_scope: ["src/t1.ts"],
      gate: "bun test",
      charter_goals: [],
      acceptance_criteria: [],
      dependencies: [],
      blocked_by: [],
      source_type: "self_evolution",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      retry_count: 0,
      max_retries: 3,
      lease: {
        agent_id: "a1",
        token: "tok-123",
        leased_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60000).toISOString(),
        attempt: 1,
        lease_duration_seconds: 60,
      },
    };

    expect(() => assertValidActiveLease(validTask, "tok-123")).not.toThrow();
    expect(() => assertValidActiveLease(validTask, "wrong-tok")).toThrow(HarnessError);

    const expiredTask: TaskQueueItem = {
      ...validTask,
      lease: { ...validTask.lease!, expires_at: new Date(Date.now() - 1000).toISOString() },
    };
    expect(() => assertValidActiveLease(expiredTask)).toThrow(HarnessError);

    const noLeaseTask: TaskQueueItem = { ...validTask, lease: null };
    expect(() => assertValidActiveLease(noLeaseTask)).toThrow(HarnessError);
  });

  test("validateCompletionReceipts verifies mechanical and cognitive channels", () => {
    expect(() =>
      validateCompletionReceipts({ exit_code: 0, cognitive_verdict: "PASS" }),
    ).not.toThrow();
    expect(() => validateCompletionReceipts()).not.toThrow();
    expect(() => validateCompletionReceipts({ exit_code: 1 })).toThrow(HarnessError);
    expect(() => validateCompletionReceipts({ cognitive_verdict: "FAIL" })).toThrow(HarnessError);
  });

  test("assertWriteScopeASTPurity detects comments in source files", () => {
    const cleanFile = join(testDir, "clean.ts");
    const commentedFile = join(testDir, "commented.ts");
    writeFileSync(cleanFile, "export const x = 1;\n");
    writeFileSync(commentedFile, "export const y = 2;\n// comment\n");

    expect(() => assertWriteScopeASTPurity(testDir, ["clean.ts"])).not.toThrow();
    expect(() => assertWriteScopeASTPurity(testDir, ["commented.ts"])).toThrow(HarnessError);
  });

  test("stageWorktreeProgress executes git add -A", () => {
    const gitDir = join(testDir, "git-test");
    mkdirSync(gitDir, { recursive: true });
    const { spawnSync } = require("node:child_process");
    spawnSync("git", ["init", "--quiet"], { cwd: gitDir });
    writeFileSync(join(gitDir, "file.txt"), "hello");

    expect(() => stageWorktreeProgress(gitDir)).not.toThrow();
    const status = spawnSync("git", ["status", "--porcelain"], { cwd: gitDir, encoding: "utf8" });
    expect(status.stdout).toContain("A  file.txt");
  });

  test("translateSuspendedLeases shifts lease deadlines forward", () => {
    const expires = new Date(Date.now() + 10000).toISOString();
    const task: TaskQueueItem = {
      id: "t-freeze",
      title: "Freeze",
      description: "",
      priority: "HIGH",
      status: "IN_PROGRESS",
      write_scope: ["src/freeze.ts"],
      gate: "bun test",
      charter_goals: [],
      acceptance_criteria: [],
      dependencies: [],
      blocked_by: [],
      source_type: "self_evolution",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      retry_count: 0,
      max_retries: 3,
      lease: {
        agent_id: "agent-freeze",
        token: "tok-freeze",
        leased_at: new Date().toISOString(),
        expires_at: expires,
        attempt: 1,
        lease_duration_seconds: 10,
      },
    };

    const res = translateSuspendedLeases([task], 5000);
    expect(res.translatedCount).toBe(1);
    const updatedExp = Date.parse(res.tasks[0]!.lease!.expires_at);
    expect(updatedExp).toBe(Date.parse(expires) + 5000);

    const zeroRes = translateSuspendedLeases([task], 0);
    expect(zeroRes.translatedCount).toBe(0);
  });
});
