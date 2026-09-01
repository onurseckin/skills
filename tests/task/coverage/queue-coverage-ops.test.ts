import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { scratchRoot } from "../task-fixture.ts";
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
} from "../../../olt/scripts/src/task/queue/index.ts";
import { createSampleTaskQueueStats, TASK_COVERAGE_SUITES } from "./index.ts";
import {
  createInMemoryCompletionReceipts,
  createInMemoryTaskItem,
  createInMemoryTaskLease,
  createInMemoryTaskQueue,
  createSandboxDir,
  InMemoryTaskQueue,
  TASK_DOMAIN_SUITES,
} from "../index.ts";
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
} from "../../../olt/scripts/src/task/queue/types.ts";
import {
  serializeTaskQueue,
  parseTaskQueue,
  isOwnCode,
  isOwnEnoent,
} from "../../../olt/scripts/src/task/queue/storage.ts";
import {
  assertValidActiveLease,
  assertWriteScopeASTPurity,
  stageWorktreeProgress,
  translateSuspendedLeases,
} from "../../../olt/scripts/src/task/queue/lease.ts";
import {
  resolveTaskQueueLockPath,
  withTaskQueueLock,
  withTaskQueueTransaction,
} from "../../../olt/scripts/src/task/queue/locks.ts";

describe("Task Queue Comprehensive Coverage", () => {
  const testDirQueue = scratchRoot(import.meta.path, "queue");
  const testDirArchive = scratchRoot(import.meta.path, "archive");
  const queuePath = join(testDirQueue, "queue", "TASK_QUEUE.jsonl");
  const completedPath = join(testDirArchive, "archived", "COMPLETED_TASKS.jsonl");

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

    const stats = createSampleTaskQueueStats();
    expect(stats.total).toBe(10);
    expect(TASK_COVERAGE_SUITES.length).toBe(4);
    expect(Object.keys(TASK_DOMAIN_SUITES).length).toBe(4);

    const memQueue = createInMemoryTaskQueue();
    expect(memQueue).toBeInstanceOf(InMemoryTaskQueue);
    const queued = memQueue.enqueue({
      taskId: "t-mem-1",
      role: "implementer",
      priority: "high",
      effort: 1,
      title: "Test",
      description: "Desc",
    });
    expect(queued.taskId).toBe("t-mem-1");
    expect(queued.status).toBe("ready");
    expect(memQueue.get("t-mem-1")?.taskId).toBe("t-mem-1");
    expect(memQueue.list().length).toBe(1);

    const claimed = memQueue.claim("t-mem-1", "worker_1");
    expect(claimed?.status).toBe("claimed");
    expect(claimed?.assignedTo).toBe("worker_1");

    const comp = memQueue.complete("t-mem-1");
    expect(comp?.status).toBe("completed");

    const memStats = memQueue.getStats();
    expect(memStats.completed).toBe(1);
    expect(memStats.total).toBe(1);

    memQueue.clear();
    expect(memQueue.list().length).toBe(0);

    const inMemItem = createInMemoryTaskItem({ taskId: "item-1" });
    expect(inMemItem.taskId).toBe("item-1");
    const inMemLease = createInMemoryTaskLease({ holder: "h1" });
    expect(inMemLease.holder).toBe("h1");
    const inMemReceipt = createInMemoryCompletionReceipts({ verifiedCommit: "c1" });
    expect(inMemReceipt.verifiedCommit).toBe("c1");
    const root = scratchRoot(import.meta.path, "test");
    expect(typeof root).toBe("string");
    const sandbox = createSandboxDir("test-sandbox");
    expect(typeof sandbox).toBe("string");
  });
});
