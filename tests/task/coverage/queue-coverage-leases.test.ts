import { describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  claimTaskLease,
  completeTask,
  enqueueTask,
  enqueueTasksBatch,
  reclaimExpiredLeases,
  releaseTaskLease,
  renewTaskLease,
  startTaskValidation,
  type TaskQueueItem,
} from "../../../olt/scripts/src/task/queue/index.ts";
import {
  assertValidActiveLease,
  assertWriteScopeASTPurity,
  stageWorktreeProgress,
  translateSuspendedLeases,
} from "../../../olt/scripts/src/task/queue/lease.ts";

describe("Task Queue Comprehensive Coverage", () => {
  const testDirQueue = mkdtempSync(join(tmpdir(), "test-task-queue-comp-q-"));
  const testDirArchive = mkdtempSync(join(tmpdir(), "test-task-queue-comp-a-"));
  const queuePath = join(testDirQueue, "queue", "TASK_QUEUE.jsonl");
  const completedPath = join(testDirArchive, "archived", "COMPLETED_TASKS.jsonl");

  function setup() {
    if (existsSync(testDirQueue)) rmSync(testDirQueue, { recursive: true, force: true });
    if (existsSync(testDirArchive)) rmSync(testDirArchive, { recursive: true, force: true });
    mkdirSync(join(testDirQueue, "queue"), { recursive: true });
    mkdirSync(join(testDirArchive, "archived"), { recursive: true });
    execSync("git init", { cwd: testDirQueue, stdio: "ignore" });
    writeFileSync(completedPath, "");
  }

  function teardown() {
    if (existsSync(testDirQueue)) rmSync(testDirQueue, { recursive: true, force: true });
    if (existsSync(testDirArchive)) rmSync(testDirArchive, { recursive: true, force: true });
  }

  it("covers batch enqueuing and blocked_by dependency resolution", () => {
    setup();
    const tasks = enqueueTasksBatch(
      [
        {
          id: "dep-1",
          title: "Dep 1",
          priority: "HIGH",
          write_scope: ["src/1.ts"],
          gate: "bun test",
        },
        {
          id: "dep-2",
          title: "Dep 2",
          priority: "HIGH",
          write_scope: ["src/2.ts"],
          gate: "bun test",
          dependencies: ["dep-1"],
        },
        {
          id: "dep-3",
          title: "Dep 3",
          priority: "HIGH",
          write_scope: ["src/3.ts"],
          gate: "bun test",
          dependencies: ["dep-2"],
        },
      ],
      queuePath,
    );
    expect(tasks.length).toBe(3);
    expect(tasks[0]!.status).toBe("PENDING");
    expect(tasks[1]!.status).toBe("BLOCKED");
    expect(tasks[2]!.status).toBe("BLOCKED");

    // Completing dep-1 unblocks dep-2
    const completeDep1 = completeTask("dep-1", undefined, undefined, queuePath);
    expect(completeDep1.unblockedTasks.length).toBe(1);
    expect(completeDep1.unblockedTasks[0]!.id).toBe("dep-2");
    expect(completeDep1.unblockedTasks[0]!.status).toBe("PENDING");

    // Duplicate in batch throws
    expect(() =>
      enqueueTasksBatch(
        [
          {
            id: "dup-1",
            title: "Dup 1",
            priority: "HIGH",
            write_scope: ["src/d.ts"],
            gate: "bun test",
          },
          {
            id: "dup-1",
            title: "Dup 1 repeat",
            priority: "HIGH",
            write_scope: ["src/d.ts"],
            gate: "bun test",
          },
        ],
        queuePath,
      ),
    ).toThrow(HarnessError);

    teardown();
  });

  it("covers lease operations: renew, release, reclaim, expiry, and helper guards", () => {
    setup();
    enqueueTask(
      {
        id: "lease-task",
        title: "Lease Task",
        priority: "CRITICAL",
        write_scope: ["src/l.ts"],
        gate: "bun test",
      },
      queuePath,
    );

    const claimed = claimTaskLease({
      taskId: "lease-task",
      agentId: "agent-x",
      durationSeconds: 10,
      customPath: queuePath,
    });
    expect(claimed.task.lease?.agent_id).toBe("agent-x");

    // assertValidActiveLease
    expect(() => assertValidActiveLease(claimed.task, claimed.leaseToken)).not.toThrow();
    expect(() => assertValidActiveLease({ ...claimed.task, lease: null })).toThrow(HarnessError);
    expect(() => assertValidActiveLease(claimed.task, "bad-token")).toThrow(HarnessError);
    expect(() =>
      assertValidActiveLease({
        ...claimed.task,
        lease: { ...claimed.task.lease!, expires_at: new Date(Date.now() - 1000).toISOString() },
      }),
    ).toThrow(HarnessError);

    // Re-claiming active lease with different agent throws
    expect(() =>
      claimTaskLease({ taskId: "lease-task", agentId: "agent-y", customPath: queuePath }),
    ).toThrow(HarnessError);

    // Renew lease with correct token
    const token = claimed.leaseToken;
    const renewed = renewTaskLease({
      taskId: "lease-task",
      agentId: "agent-x",
      leaseToken: token,
      extensionSeconds: 30,
      customPath: queuePath,
    });
    expect(renewed.lease?.token).toBe(token);

    // Renew with invalid token throws
    expect(() =>
      renewTaskLease({
        taskId: "lease-task",
        agentId: "agent-x",
        leaseToken: "invalid-token",
        customPath: queuePath,
      }),
    ).toThrow(HarnessError);

    // Release lease
    const released = releaseTaskLease({
      taskId: "lease-task",
      agentId: "agent-x",
      leaseToken: token,
      customPath: queuePath,
    });
    expect(released.lease).toBeNull();
    expect(released.status).toBe("PENDING");

    // Release lease mismatch agent throws
    const reclaimedForErr = claimTaskLease({
      taskId: "lease-task",
      agentId: "agent-x",
      customPath: queuePath,
    });
    expect(() =>
      releaseTaskLease({ taskId: "lease-task", agentId: "agent-wrong", customPath: queuePath }),
    ).toThrow(HarnessError);
    expect(() =>
      releaseTaskLease({
        taskId: "lease-task",
        agentId: "agent-x",
        leaseToken: "wrong-tok",
        customPath: queuePath,
      }),
    ).toThrow(HarnessError);
    releaseTaskLease({ taskId: "lease-task", agentId: "agent-x", customPath: queuePath });

    // translateSuspendedLeases
    const translated = translateSuspendedLeases([claimed.task], 60_000);
    expect(translated.translatedCount).toBe(1);
    expect(translateSuspendedLeases([claimed.task], 0).translatedCount).toBe(0);

    // AST purity assertion
    assertWriteScopeASTPurity(process.cwd(), []);
    stageWorktreeProgress(testDirQueue);

    teardown();
  });

  it("covers startTaskValidation errors and edge cases", () => {
    setup();
    enqueueTask(
      {
        id: "val-task",
        title: "Val Task",
        priority: "HIGH",
        write_scope: ["src/v.ts"],
        gate: "bun test",
      },
      queuePath,
    );
    const claimed = claimTaskLease({
      taskId: "val-task",
      agentId: "agent-val",
      customPath: queuePath,
    });

    // Valid startTaskValidation
    const validating = startTaskValidation({
      taskId: "val-task",
      agentId: "agent-val",
      leaseToken: claimed.leaseToken,
      customPath: queuePath,
    });
    expect(validating.status).toBe("VALIDATING");

    // Token mismatch throws
    expect(() =>
      startTaskValidation({ taskId: "val-task", leaseToken: "bad-token", customPath: queuePath }),
    ).toThrow(HarnessError);

    // Agent mismatch throws
    expect(() =>
      startTaskValidation({ taskId: "val-task", agentId: "wrong-agent", customPath: queuePath }),
    ).toThrow(HarnessError);

    // Cannot validate completed task
    completeTask({ taskId: "val-task", customPath: queuePath });
    expect(() => startTaskValidation({ taskId: "val-task", customPath: queuePath })).toThrow(
      HarnessError,
    );

    teardown();
  });
});
