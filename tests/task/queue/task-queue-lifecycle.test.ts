import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  claimTaskLease,
  completeTask,
  enqueueTask,
  enqueueTasksBatch,
  failTask,
  popNextEligibleTask,
  readTaskQueue,
  reclaimExpiredLeases,
  releaseTaskLease,
  renewTaskLease,
  type TaskQueueItem,
} from "../../../olt/scripts/src/task/queue/index.ts";

describe("Stateful Task Queue Engine", () => {
  const testDir = mkdtempSync(join(tmpdir(), "test-task-queue-"));
  const queuePath = join(testDir, "TASK_QUEUE.jsonl");

  function setup() {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
  }

  function teardown() {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  }

  it("pops highest priority eligible task from queue", () => {
    setup();
    enqueueTasksBatch(
      [
        {
          id: "task-low",
          title: "Low Priority",
          priority: "LOW",
          write_scope: ["src/low.ts"],
          gate: "bun test",
        },
        {
          id: "task-crit",
          title: "Critical Priority",
          priority: "CRITICAL",
          write_scope: ["src/crit.ts"],
          gate: "bun test",
        },
        {
          id: "task-high-blocked",
          title: "High Priority Blocked",
          priority: "HIGH",
          write_scope: ["src/high.ts"],
          gate: "bun test",
          dependencies: ["task-crit"],
        },
      ],
      queuePath,
    );

    const popped = popNextEligibleTask({
      agentId: "agent-worker",
      customPath: queuePath,
    });

    expect(popped).not.toBeNull();
    expect(popped!.task.id).toBe("task-crit");
    expect(popped!.task.status).toBe("IN_PROGRESS");

    const secondPopped = popNextEligibleTask({
      agentId: "agent-worker-2",
      customPath: queuePath,
    });

    expect(secondPopped).not.toBeNull();
    expect(secondPopped!.task.id).toBe("task-low");

    const thirdPopped = popNextEligibleTask({
      agentId: "agent-worker-3",
      customPath: queuePath,
    });
    expect(thirdPopped).toBeNull();
    teardown();
  });

  it("completes task and unblocks dependent tasks cleanly", () => {
    setup();
    enqueueTasksBatch(
      [
        {
          id: "task-foundation",
          title: "Foundation Task",
          write_scope: ["src/foundation.ts"],
          gate: "bun test",
        },
        {
          id: "task-dependent-1",
          title: "Dependent 1",
          write_scope: ["src/dep1.ts"],
          gate: "bun test",
          dependencies: ["task-foundation"],
        },
        {
          id: "task-dependent-2",
          title: "Dependent 2",
          write_scope: ["src/dep2.ts"],
          gate: "bun test",
          dependencies: ["task-foundation", "task-dependent-1"],
        },
      ],
      queuePath,
    );

    const initialQueue = readTaskQueue(queuePath);
    expect(initialQueue.find((t) => t.id === "task-dependent-1")!.status).toBe("BLOCKED");
    expect(initialQueue.find((t) => t.id === "task-dependent-2")!.status).toBe("BLOCKED");

    const comp1 = completeTask({
      taskId: "task-foundation",
      customPath: queuePath,
    });

    expect(comp1.completedTask.status).toBe("COMPLETED");
    expect(comp1.unblockedTasks.length).toBe(1);
    expect(comp1.unblockedTasks[0]!.id).toBe("task-dependent-1");

    const midQueue = readTaskQueue(queuePath);
    expect(midQueue.find((t) => t.id === "task-dependent-1")!.status).toBe("PENDING");
    expect(midQueue.find((t) => t.id === "task-dependent-2")!.status).toBe("BLOCKED");
    expect(midQueue.find((t) => t.id === "task-dependent-2")!.blocked_by).toEqual([
      "task-dependent-1",
    ]);

    const comp2 = completeTask({
      taskId: "task-dependent-1",
      customPath: queuePath,
    });

    expect(comp2.unblockedTasks.length).toBe(1);
    expect(comp2.unblockedTasks[0]!.id).toBe("task-dependent-2");

    const finalQueue = readTaskQueue(queuePath);
    expect(finalQueue.find((t) => t.id === "task-dependent-2")!.status).toBe("PENDING");
    expect(finalQueue.find((t) => t.id === "task-dependent-2")!.blocked_by).toEqual([]);
    teardown();
  });

  it("handles task failure and retries up to max_retries", () => {
    setup();
    enqueueTask(
      {
        id: "task-fail-retry",
        title: "Flaky Task",
        write_scope: ["src/flaky.ts"],
        gate: "bun test",
        max_retries: 2,
      },
      queuePath,
    );

    const res1 = failTask({
      taskId: "task-fail-retry",
      errorMessage: "First transient failure",
      customPath: queuePath,
    });

    expect(res1.retried).toBe(true);
    expect(res1.task.retry_count).toBe(1);
    expect(res1.task.status).toBe("PENDING");

    const res2 = failTask({
      taskId: "task-fail-retry",
      errorMessage: "Second transient failure",
      customPath: queuePath,
    });

    expect(res2.retried).toBe(true);
    expect(res2.task.retry_count).toBe(2);
    expect(res2.task.status).toBe("PENDING");

    const res3 = failTask({
      taskId: "task-fail-retry",
      errorMessage: "Permanent failure",
      customPath: queuePath,
    });

    expect(res3.retried).toBe(false);
    expect(res3.task.status).toBe("FAILED");
    expect(res3.task.failed_at).toBeDefined();
    teardown();
  });

  it("reclaims expired leases and resets them to PENDING", () => {
    setup();
    enqueueTask(
      {
        id: "task-timeout",
        title: "Timeout Task",
        write_scope: ["src/timeout.ts"],
        gate: "bun test",
        max_retries: 3,
      },
      queuePath,
    );

    const nowIso = new Date(Date.now() - 5000).toISOString();
    claimTaskLease({
      taskId: "task-timeout",
      agentId: "agent-dead",
      durationSeconds: 1,
      customPath: queuePath,
      nowIso,
    });

    const queueBeforeReclaim = readTaskQueue(queuePath);
    expect(queueBeforeReclaim[0]!.status).toBe("IN_PROGRESS");

    const reclaimResult = reclaimExpiredLeases({
      customPath: queuePath,
      nowMs: Date.now(),
    });

    expect(reclaimResult.reclaimedCount).toBe(1);
    expect(reclaimResult.tasks[0]!.id).toBe("task-timeout");
    expect(reclaimResult.tasks[0]!.status).toBe("PENDING");
    expect(reclaimResult.tasks[0]!.retry_count).toBe(1);
    expect(reclaimResult.tasks[0]!.lease).toBeNull();
    teardown();
  });

  it("renews and releases task leases", () => {
    setup();
    enqueueTask(
      {
        id: "task-renew-release",
        title: "Renew Release Task",
        write_scope: ["src/rr.ts"],
        gate: "bun test",
      },
      queuePath,
    );

    const claim = claimTaskLease({
      taskId: "task-renew-release",
      agentId: "agent-active",
      durationSeconds: 100,
      customPath: queuePath,
    });

    const renewed = renewTaskLease({
      taskId: "task-renew-release",
      agentId: "agent-active",
      leaseToken: claim.leaseToken,
      extensionSeconds: 500,
      customPath: queuePath,
    });

    expect(renewed.lease?.lease_duration_seconds).toBe(500);

    const released = releaseTaskLease({
      taskId: "task-renew-release",
      agentId: "agent-active",
      leaseToken: claim.leaseToken,
      customPath: queuePath,
    });

    expect(released.status).toBe("PENDING");
    expect(released.lease).toBeNull();
    teardown();
  });

});
