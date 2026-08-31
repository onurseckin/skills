import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  admitTask,
  admitTaskUnlocked,
  claimTaskLease,
  claimTaskLeaseUnlocked,
  clearTaskQueue,
  clearTaskQueueUnlocked,
  compactTaskQueue,
  completeTask,
  completeTaskUnlocked,
  dequeueEligibleTaskUnlocked,
  dequeueTask,
  enqueueTask,
  enqueueTasksBatch,
  enqueueTaskUnlocked,
  escalateTask,
  escalateTaskUnlocked,
  failTask,
  failTaskUnlocked,
  getQueueStats,
  getQueueStatsUnlocked,
  getTaskQueueStats,
  listTaskQueue,
  popNextEligibleTask,
  popNextEligibleTaskWithCleanup,
  pruneCompletedTasks,
  pruneCompletedTasksUnlocked,
  pruneTaskQueue,
  readTaskQueue,
  readTaskQueueFile,
  reclaimExpiredLeases,
  reclaimExpiredLeasesUnlocked,
  releaseTaskLease,
  releaseTaskLeaseUnlocked,
  renewTaskLease,
  renewTaskLeaseUnlocked,
  startTaskValidation,
  startTaskValidationUnlocked,
  validateCompletionReceipts,
  validateTaskQueueDag,
  writeTaskQueue,
  writeTaskQueueUnlocked,
  type CompletionReceipts,
  type TaskQueueItem,
} from "../../../../olt/scripts/src/task/queue/index.ts";
import {
  TASK_QUEUE_STATUSES,
  TASK_PRIORITIES,
  PRIORITY_WEIGHTS,
  DEFAULT_TASK_QUEUE_FILE,
  DEFAULT_LEASE_DURATION_MS,
  DEFAULT_LEASE_DURATION_SECONDS,
  DEFAULT_MAX_RETRIES,
  resolveTaskQueuePath,
  resolveCanonicalTaskQueuePath,
  __setTaskQueuePersistenceTestHook,
  invokeTaskQueuePersistenceHook,
  validateSourceType,
  deserializeTaskQueueItem,
} from "../../../../olt/scripts/src/task/queue/types.ts";
import {
  serializeTaskQueue,
  parseTaskQueue,
  isOwnCode,
  isOwnEnoent,
} from "../../../../olt/scripts/src/task/queue/storage.ts";
import {
  assertValidActiveLease,
  assertWriteScopeASTPurity,
  stageWorktreeProgress,
  translateSuspendedLeases,
} from "../../../../olt/scripts/src/task/queue/lease.ts";
import {
  resolveTaskQueueLockPath,
  withTaskQueueLock,
  withTaskQueueTransaction,
} from "../../../../olt/scripts/src/task/queue/locks.ts";
import { scratchRoot } from "../../../support/scratch-root.ts";

describe("Task Queue Comprehensive Coverage", () => {
  const testDirQueue = scratchRoot(import.meta.path, "test-task-queue-comp-q");
  const testDirArchive = scratchRoot(import.meta.path, "test-task-queue-comp-a");
  const queuePath = join(testDirQueue, "queue", "TASK_QUEUE.jsonl");
  const completedPath = join(testDirArchive, "archived", "COMPLETED_TASKS.jsonl");

  function setup() {
    if (existsSync(testDirQueue)) {
      rmSync(testDirQueue, { recursive: true, force: true });
    }
    if (existsSync(testDirArchive)) {
      rmSync(testDirArchive, { recursive: true, force: true });
    }
    mkdirSync(join(testDirQueue, "queue"), { recursive: true });
    mkdirSync(join(testDirArchive, "archived"), { recursive: true });
    writeFileSync(completedPath, "");
  }

  function teardown() {
    if (existsSync(testDirQueue)) {
      rmSync(testDirQueue, { recursive: true, force: true });
    }
    if (existsSync(testDirArchive)) {
      rmSync(testDirArchive, { recursive: true, force: true });
    }
  }

  it("covers completeTask and completeTaskUnlocked with all receipt and archive permutations", () => {
    setup();
    enqueueTask(
      {
        id: "task-comp-1",
        title: "Task Comp 1",
        description: "Comp test task",
        priority: "HIGH",
        write_scope: ["src/a.ts"],
        gate: "bun test",
        metadata: {
          category: "TESTING",
          test_path: "tests/a.test.ts",
          assertions: ["5"],
          runtime_ms: "120",
          commit_sha: "abc1234",
        },
      },
      queuePath,
    );

    const leaseRes = claimTaskLease({
      taskId: "task-comp-1",
      agentId: "agent-1",
      customPath: queuePath,
      durationSeconds: 60,
    });

    // Call completeTask using object with autoArchive
    const res1 = completeTask({
      taskId: "task-comp-1",
      leaseToken: leaseRes.leaseToken,
      autoArchive: true,
      completedTasksPath: completedPath,
      proofSummary: "Custom proof summary",
      customPath: queuePath,
    });
    expect(res1.completedTask.status).toBe("COMPLETED");
    expect(res1.archivedRecord).toBeDefined();
    expect(res1.archivedRecord?.proof_summary).toBe("Custom proof summary");

    // Re-completing already completed task returns it immediately
    const resAlready = completeTask({ taskId: "task-comp-1", customPath: queuePath });
    expect(resAlready.completedTask.status).toBe("COMPLETED");

    // String overload with path in receiptsArgOrPath
    enqueueTask(
      {
        id: "task-comp-str",
        title: "Task Str",
        priority: "HIGH",
        write_scope: ["src/s.ts"],
        gate: "bun test",
      },
      queuePath,
    );
    const leaseStr = claimTaskLease({
      taskId: "task-comp-str",
      agentId: "agent-str",
      customPath: queuePath,
    });
    const resStr = completeTask("task-comp-str", leaseStr.leaseToken, queuePath);
    expect(resStr.completedTask.status).toBe("COMPLETED");

    // String overload with receipts object
    enqueueTask(
      {
        id: "task-comp-str-rec",
        title: "Task Str Rec",
        priority: "HIGH",
        write_scope: ["src/s2.ts"],
        gate: "bun test",
      },
      queuePath,
    );
    const leaseStrRec = claimTaskLease({
      taskId: "task-comp-str-rec",
      agentId: "agent-str-rec",
      customPath: queuePath,
    });
    const resStrRec = completeTask(
      "task-comp-str-rec",
      { proof_summary: "Done" },
      undefined,
      queuePath,
    );
    expect(resStrRec.completedTask.status).toBe("COMPLETED");

    // Mismatched token throws
    enqueueTask(
      {
        id: "task-comp-2",
        title: "Task 2",
        priority: "MEDIUM",
        write_scope: ["src/b.ts"],
        gate: "bun test",
      },
      queuePath,
    );
    const lease2 = claimTaskLease({
      taskId: "task-comp-2",
      agentId: "agent-2",
      customPath: queuePath,
    });
    expect(() =>
      completeTask({ taskId: "task-comp-2", leaseToken: "wrong-token", customPath: queuePath }),
    ).toThrow(HarnessError);

    // Complete with autoPrune=true
    const pruneRes = completeTask({
      taskId: "task-comp-2",
      leaseToken: lease2.leaseToken,
      autoPrune: true,
      autoArchive: true,
      customPath: queuePath,
      completedTasksPath: completedPath,
    });
    expect(pruneRes.completedTask.id).toBe("task-comp-2");
    const remaining = readTaskQueue(queuePath);
    expect(remaining.some((t) => t.id === "task-comp-2")).toBe(false);

    // Missing task throws
    expect(() => completeTask({ taskId: "non-existent", customPath: queuePath })).toThrow(
      HarnessError,
    );

    teardown();
  });

  it("covers validateCompletionReceipts edge cases", () => {
    expect(() => validateCompletionReceipts(undefined)).not.toThrow();
    expect(() => validateCompletionReceipts({})).not.toThrow();
    expect(() =>
      validateCompletionReceipts({ exit_code: 0, cognitive_verdict: "PASS" }),
    ).not.toThrow();
    expect(() =>
      validateCompletionReceipts({
        exit_code: 1,
      }),
    ).toThrow(HarnessError);
    expect(() =>
      validateCompletionReceipts({
        cognitive_verdict: "FAIL",
      }),
    ).toThrow(HarnessError);
  });

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

  it("covers maintenance, list, pruneTaskQueue, compactTaskQueue, and stats", () => {
    setup();
    enqueueTask(
      { id: "m-1", title: "M 1", priority: "LOW", write_scope: ["src/m1.ts"], gate: "bun test" },
      queuePath,
    );
    enqueueTask(
      { id: "m-2", title: "M 2", priority: "HIGH", write_scope: ["src/m2.ts"], gate: "bun test" },
      queuePath,
    );
    completeTask("m-1", undefined, undefined, queuePath);

    const stats = getQueueStats(queuePath);
    expect(stats.total).toBe(2);
    expect(stats.completed).toBe(1);
    expect(stats.pending).toBe(1);
    expect(getTaskQueueStats(queuePath).total).toBe(2);

    const list = listTaskQueue({
      customPath: queuePath,
      search: "m-2",
      priority: "HIGH",
      limit: 1,
    });
    expect(list.length).toBe(1);
    expect(list[0]!.id).toBe("m-2");

    const pruned = pruneTaskQueue({ customPath: queuePath });
    expect(pruned.prunedCount).toBe(1);
    expect(pruned.remainingCount).toBe(1);

    const compacted = compactTaskQueue(queuePath);
    expect(compacted).toBeDefined();

    const dagValidation = validateTaskQueueDag(readTaskQueue(queuePath));
    expect(dagValidation.ok).toBe(true);

    clearTaskQueue(queuePath);
    expect(readTaskQueue(queuePath).length).toBe(0);

    teardown();
  });

  it("covers locks.ts helpers and lock paths", async () => {
    const lockPath1 = resolveTaskQueueLockPath(".olt/tasks.jsonl");
    expect(lockPath1).toContain("locks");
    const lockPath2 = resolveTaskQueueLockPath("custom/path/tasks.jsonl");
    expect(lockPath2).toContain(".task-queue.lock");

    // withTaskQueueLock
    setup();
    const res = await withTaskQueueLock(queuePath, () => 42);
    expect(res).toBe(42);
    teardown();
  });

  it("covers type guards, validators, and serializers in types.ts", () => {
    expect(TASK_QUEUE_STATUSES).toContain("PENDING");
    expect(TASK_PRIORITIES).toContain("CRITICAL");
    expect(PRIORITY_WEIGHTS.CRITICAL).toBe(100);
    expect(DEFAULT_TASK_QUEUE_FILE).toBe(".olt/tasks.jsonl");
    expect(DEFAULT_LEASE_DURATION_MS).toBe(300_000);
    expect(DEFAULT_LEASE_DURATION_SECONDS).toBe(1800);
    expect(DEFAULT_MAX_RETRIES).toBe(3);

    expect(validateSourceType("external_intake")).toBe("external_intake");
    expect(validateSourceType("invalid" as unknown as string)).toBe("self_evolution");

    expect(resolveTaskQueuePath(queuePath)).toBe(queuePath);
    expect(resolveCanonicalTaskQueuePath(queuePath)).toBe(queuePath);
    expect(resolveTaskQueuePath("")).toBeDefined();

    // Hooks
    let stageCalled = "";
    __setTaskQueuePersistenceTestHook((stage) => {
      stageCalled = stage;
    });
    invokeTaskQueuePersistenceHook("before_write");
    expect(stageCalled).toBe("before_write");
    __setTaskQueuePersistenceTestHook(undefined);
    invokeTaskQueuePersistenceHook("after_rename");

    // Serialization & Deserialization
    const item: TaskQueueItem = {
      id: "ser-1",
      title: "Title",
      description: "Desc",
      priority: "HIGH",
      status: "PENDING",
      write_scope: ["src/1.ts"],
      gate: "bun test",
      charter_goals: ["g1"],
      acceptance_criteria: ["ac1"],
      dependencies: [],
      blocked_by: [],
      source_type: "external_intake",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      retry_count: 0,
      max_retries: 3,
    };
    const serialized = serializeTaskQueue([item]);
    expect(serialized).toContain("ser-1");
    const parsed = parseTaskQueue(serialized);
    expect(parsed.length).toBe(1);
    expect(parsed[0]!.id).toBe("ser-1");

    expect(isOwnCode(new Error("test"), "ENOENT")).toBe(false);
    expect(isOwnEnoent(new Error("test"))).toBe(false);

    // Invalid deserialization throws
    expect(() => deserializeTaskQueueItem({} as Record<string, unknown>)).toThrow(HarnessError);
    expect(() =>
      deserializeTaskQueueItem({
        id: "ser-2",
        title: "T",
        status: "INVALID",
        write_scope: ["s"],
        gate: "g",
      } as Record<string, unknown>),
    ).toThrow(HarnessError);
  });
});
