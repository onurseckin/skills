import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import {
  admitTask,
  claimTaskLease,
  completeTask,
  dequeueTask,
  enqueueTask,
  escalateTask,
  failTask,
  popNextEligibleTask,
  popNextEligibleTaskWithCleanup,
  reclaimExpiredLeases,
  startTaskValidation,
} from "../../olt/scripts/src/task/queue/index.ts";
import { cleanupVirtualTaskFS, scratchRoot, setupVirtualTaskFS } from "./task-fixture.ts";

describe("Task Queue Comprehensive Coverage", () => {
  let testDirQueue = "";
  let testDirArchive = "";
  let queuePath = "";
  let completedPath = "";

  beforeEach(() => {
    setupVirtualTaskFS();
    testDirQueue = scratchRoot(import.meta.path, "queue");
    testDirArchive = scratchRoot(import.meta.path, "archive");
    queuePath = join(testDirQueue, "queue", "TASK_QUEUE.jsonl");
    completedPath = join(testDirArchive, "archived", "COMPLETED_TASKS.jsonl");
  });

  afterEach(() => {
    cleanupVirtualTaskFS();
  });

  function setup() {
    if (existsSync(testDirQueue)) rmSync(testDirQueue, { recursive: true, force: true });
    if (existsSync(testDirArchive)) rmSync(testDirArchive, { recursive: true, force: true });
    mkdirSync(join(testDirQueue, "queue"), { recursive: true });
    mkdirSync(join(testDirArchive, "archived"), { recursive: true });
    writeFileSync(completedPath, "");
  }

  function teardown() {
    if (existsSync(testDirQueue)) rmSync(testDirQueue, { recursive: true, force: true });
    if (existsSync(testDirArchive)) rmSync(testDirArchive, { recursive: true, force: true });
  }

  it("covers all state transitions and validation transitions", () => {
    setup();
    enqueueTask(
      {
        id: "trans-task",
        title: "Trans Task",
        priority: "MEDIUM",
        write_scope: ["src/t.ts"],
        gate: "bun test",
      },
      queuePath,
    );

    // PENDING -> ADMITTED
    const admitted = admitTask({ taskId: "trans-task", customPath: queuePath });
    expect(admitted.status).toBe("ADMITTED");

    // Admit non-existent task throws
    expect(() => admitTask({ taskId: "non-existent", customPath: queuePath })).toThrow(
      HarnessError,
    );

    // ADMITTED -> CLAIMED
    const claimed = claimTaskLease({
      taskId: "trans-task",
      agentId: "agent-trans",
      customPath: queuePath,
    });
    expect(claimed.task.status).toBe("IN_PROGRESS");

    // IN_PROGRESS -> VALIDATING
    const validating = startTaskValidation({
      taskId: "trans-task",
      leaseToken: claimed.leaseToken,
      customPath: queuePath,
    });
    expect(validating.status).toBe("VALIDATING");

    // VALIDATING -> ESCALATED
    const escalated = escalateTask({
      taskId: "trans-task",
      reason: "Need senior review",
      customPath: queuePath,
    });
    expect(escalated.task.status).toBe("ESCALATED");

    // Claim on escalated task throws
    expect(() =>
      claimTaskLease({ taskId: "trans-task", agentId: "agent-trans", customPath: queuePath }),
    ).toThrow(HarnessError);

    // ESCALATED -> FAILED
    const failed = failTask({
      taskId: "trans-task",
      errorMessage: "Unresolvable defect",
      customPath: queuePath,
      canRetry: false,
    });
    expect(failed.task.status).toBe("FAILED");

    // Cannot escalate completed task
    enqueueTask(
      {
        id: "done-task",
        title: "Done Task",
        priority: "HIGH",
        write_scope: ["src/d.ts"],
        gate: "bun test",
      },
      queuePath,
    );
    completeTask({ taskId: "done-task", customPath: queuePath });
    expect(() =>
      escalateTask({ taskId: "done-task", reason: "Cannot escalate done", customPath: queuePath }),
    ).toThrow(HarnessError);

    // Fail with retry
    enqueueTask(
      {
        id: "retry-task",
        title: "Retry Task",
        priority: "LOW",
        write_scope: ["src/r.ts"],
        gate: "bun test",
        max_retries: 3,
      },
      queuePath,
    );
    const retried = failTask("retry-task", undefined, "Failed once", true, queuePath);
    expect(retried.retried).toBe(true);
    expect(retried.task.retry_count).toBe(1);

    // Fail with max retries exceeded and escalate
    const escOnMax = failTask({
      taskId: "retry-task",
      errorMessage: "Failed again",
      canRetry: false,
      escalateOnMaxRetries: true,
      customPath: queuePath,
    });
    expect(escOnMax.escalated).toBe(true);

    teardown();
  });

  it("covers dequeue filtering, popping, and lease expiry reclamation", () => {
    setup();
    enqueueTask(
      { id: "pop-1", title: "Pop 1", priority: "LOW", write_scope: ["src/1.ts"], gate: "bun test" },
      queuePath,
    );
    enqueueTask(
      {
        id: "pop-2",
        title: "Pop 2",
        priority: "CRITICAL",
        write_scope: ["src/2.ts"],
        gate: "bun test",
      },
      queuePath,
    );

    // Pop next eligible should return CRITICAL before LOW
    const popped = popNextEligibleTask({
      agentId: "agent-popper",
      customPath: queuePath,
      durationSeconds: 60,
    });
    expect(popped?.task.id).toBe("pop-2");
    expect(popped?.task.lease?.agent_id).toBe("agent-popper");

    const popped2 = popNextEligibleTaskWithCleanup({
      agentId: "agent-popper-2",
      customPath: queuePath,
      durationSeconds: 60,
    });
    expect(popped2?.task.id).toBe("pop-1");

    const poppedNone = popNextEligibleTask({ agentId: "agent-none", customPath: queuePath });
    expect(poppedNone).toBeNull();

    // dequeueTask helper
    enqueueTask(
      {
        id: "pop-3",
        title: "Pop 3",
        priority: "MEDIUM",
        write_scope: ["src/3.ts"],
        gate: "bun test",
      },
      queuePath,
    );
    const dq = dequeueTask("agent-dq", 60, { customPath: queuePath });
    expect(dq?.id).toBe("pop-3");

    // Reclaim expired leases with retries exhausted -> marks task as FAILED
    enqueueTask(
      {
        id: "exp-failed-task",
        title: "Exp Failed",
        priority: "HIGH",
        write_scope: ["src/ef.ts"],
        gate: "bun test",
        max_retries: 0,
      },
      queuePath,
    );
    claimTaskLease({
      taskId: "exp-failed-task",
      agentId: "agent-exp-fail",
      durationSeconds: 1,
      customPath: queuePath,
    });
    const recRes = reclaimExpiredLeases({ customPath: queuePath, nowMs: Date.now() + 100000 });
    expect(recRes.reclaimedCount).toBeGreaterThanOrEqual(1);
    expect(recRes.tasks.some((t) => t.id === "exp-failed-task" && t.status === "FAILED")).toBe(
      true,
    );

    teardown();
  });
});
