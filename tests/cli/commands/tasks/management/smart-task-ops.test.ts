import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import {
  smartTaskCycleCommand,
  smartTaskIngestCommand,
  smartTaskQueueCompleteCommand,
  smartTaskQueueFailCommand,
  smartTaskQueueListCommand,
  smartTaskQueuePopCommand,
  smartTaskQueueReclaimCommand,
  smartTaskSynthesizeCommand,
} from "../../../../../olt/scripts/src/cli/commands/smart-task-ops.ts";
import { enqueueTasksBatch } from "../../../../../olt/scripts/src/task/queue/index.ts";
import { cleanupVirtualCliFS, setupVirtualCliFS } from "../../fixtures/full-lifecycle-fixture.ts";

const roots: string[] = [];

async function createVirtualDir(prefix: string): Promise<string> {
  const dir = `/virtual/cli/${prefix}-${Math.random().toString(36).slice(2)}`;
  roots.push(dir);
  await mkdir(dir, { recursive: true });
  return dir;
}

describe("smart-task-ops CLI commands", () => {
  beforeEach(() => {
    setupVirtualCliFS();
  });

  afterEach(() => {
    cleanupVirtualCliFS();
    roots.length = 0;
  });

  test("smartTaskSynthesizeCommand executes autonomous task synthesis", async () => {
    const root = await createVirtualDir("smart-synth");
    const queueFile = join(root, "task-queue.json");
    const capsulesDir = join(root, "capsules");

    const result = smartTaskSynthesizeCommand({
      "capsules-dir": capsulesDir,
      "queue-file": queueFile,
      "max-tasks": "3",
      goal: "Implement autonomic testing suite",
      "auto-enqueue": true,
    });

    expect(result.mode).toBeDefined();
    expect(typeof result.markdown).toBe("string");
    expect(result.tasksCount).toBeGreaterThanOrEqual(0);
    expect(result.tasks).toBeDefined();
  });

  test("smartTaskIngestCommand ingests external prompt and produces enhanced plan", async () => {
    const root = await createVirtualDir("smart-ingest");
    const queueFile = join(root, "task-queue.json");

    const result = smartTaskIngestCommand({
      prompt: "Refactor database migrations to support zero-downtime rollouts",
      id: "task-db-refactor",
      goal: "Resilient DB architecture",
      "queue-file": queueFile,
      "auto-enqueue": true,
    });

    expect(result.task).toBeDefined();
    expect(result.task.id).toContain("task-db-refactor");
    expect(result.task.write_scope.length).toBeGreaterThan(0);
    expect(result.task.gate).toBeDefined();
    expect(result.markdown).toContain("task-db-refactor");
    expect(result.markdown).toContain("- **Enqueued**: true");
  });

  test("smartTaskQueueListCommand lists queue stats and filtered tasks", async () => {
    const root = await createVirtualDir("smart-queue-list");
    const queueFile = join(root, "task-queue.json");

    // Enqueue a sample batch
    enqueueTasksBatch(
      [
        {
          id: "task-item-01",
          title: "Build telemetry collector",
          priority: "CRITICAL",
          write_scope: ["src/telemetry"],
          gate: "bun test",
        },
        {
          id: "task-item-02",
          title: "Add metrics dashboard",
          priority: "MEDIUM",
          write_scope: ["src/dashboard"],
          gate: "bun test",
          dependencies: ["task-item-01"],
        },
      ],
      queueFile,
    );

    const listResult = smartTaskQueueListCommand({
      "queue-file": queueFile,
      limit: "10",
    });

    expect(listResult.count).toBe(2);
    expect(listResult.stats.total).toBe(2);
    expect(listResult.markdown).toContain("task-item-01");
    expect(listResult.markdown).toContain("task-item-02");

    // Filter by priority
    const filterResult = smartTaskQueueListCommand({
      "queue-file": queueFile,
      priority: "CRITICAL",
    });
    expect(filterResult.count).toBe(1);
    expect(filterResult.tasks[0]?.id).toBe("task-item-01");
  });

  test("smartTaskQueuePopCommand pops and leases ready tasks", async () => {
    const root = await createVirtualDir("smart-queue-pop");
    const queueFile = join(root, "task-queue.json");

    // Empty queue pop
    const emptyPop = smartTaskQueuePopCommand({
      agent: "worker-01",
      "queue-file": queueFile,
    });
    expect(emptyPop.task).toBeNull();
    expect(emptyPop.leaseToken).toBeNull();
    expect(emptyPop.markdown).toContain("No eligible ready tasks");

    // Add task and pop
    enqueueTasksBatch(
      [
        {
          id: "task-ready-01",
          title: "Optimize serialization buffer",
          priority: "HIGH",
          write_scope: ["src/buffer"],
          gate: "bun test",
        },
      ],
      queueFile,
    );

    const activePop = smartTaskQueuePopCommand({
      agent: "worker-02",
      "lease-duration": "60",
      "queue-file": queueFile,
    });

    expect(activePop.task).toBeDefined();
    expect(activePop.task?.id).toBe("task-ready-01");
    expect(activePop.leaseToken).toBeDefined();
    expect(activePop.markdown).toContain("task-ready-01");
    expect(activePop.markdown).toContain("worker-02");
  });

  test("smartTaskQueueCompleteCommand completes leased task and unblocks dependents", async () => {
    const root = await createVirtualDir("smart-queue-complete");
    const queueFile = join(root, "task-queue.json");

    enqueueTasksBatch(
      [
        {
          id: "task-parent",
          title: "Core Kernel API",
          priority: "HIGH",
          write_scope: ["src/kernel"],
          gate: "bun test",
        },
        {
          id: "task-child",
          title: "Plugin System",
          priority: "MEDIUM",
          write_scope: ["src/plugins"],
          gate: "bun test",
          dependencies: ["task-parent"],
        },
      ],
      queueFile,
    );

    // Pop parent
    const popped = smartTaskQueuePopCommand({
      agent: "worker-kernel",
      "queue-file": queueFile,
    });
    expect(popped.task?.id).toBe("task-parent");

    // Complete parent
    const completed = smartTaskQueueCompleteCommand({
      id: "task-parent",
      agent: "worker-kernel",
      "lease-token": popped.leaseToken ?? undefined,
      "queue-file": queueFile,
    });

    expect(completed.completedTask.status).toBe("COMPLETED");
    expect(completed.unblockedTasksCount).toBe(1);
    expect(completed.unblockedTasks[0]?.id).toBe("task-child");
    expect(completed.markdown).toContain("task-parent");
    expect(completed.markdown).toContain("task-child");
  });

  test("smartTaskQueueFailCommand handles retry and permanent failure", async () => {
    const root = await createVirtualDir("smart-queue-fail");
    const queueFile = join(root, "task-queue.json");

    enqueueTasksBatch(
      [
        {
          id: "task-flaky",
          title: "Network synchronization",
          priority: "HIGH",
          write_scope: ["src/net"],
          gate: "bun test",
        },
      ],
      queueFile,
    );

    const popped = smartTaskQueuePopCommand({
      agent: "worker-net",
      "queue-file": queueFile,
    });

    // Fail with retry
    const retryResult = smartTaskQueueFailCommand({
      id: "task-flaky",
      error: "Temporary network timeout",
      agent: "worker-net",
      "lease-token": popped.leaseToken ?? undefined,
      "can-retry": true,
      "queue-file": queueFile,
    });

    expect(retryResult.retried).toBe(true);
    expect(retryResult.task.status).toBe("PENDING");
    expect(retryResult.task.retry_count).toBe(1);
    expect(retryResult.markdown).toContain("reset to PENDING");
  });

  test("smartTaskQueueReclaimCommand reclaims expired leases", async () => {
    const root = await createVirtualDir("smart-queue-reclaim");
    const queueFile = join(root, "task-queue.json");

    const result = smartTaskQueueReclaimCommand({
      "queue-file": queueFile,
    });

    expect(result.reclaimedCount).toBe(0);
    expect(result.markdown).toContain("Reclaimed Leases");
  });

  test("smartTaskCycleCommand runs autonomous dual intake cycle", async () => {
    const root = await createVirtualDir("smart-cycle");
    const queueFile = join(root, "task-queue.json");
    const capsulesDir = join(root, "capsules");

    const cycle = smartTaskCycleCommand({
      "capsules-dir": capsulesDir,
      "queue-file": queueFile,
      "max-tasks": "2",
    });

    expect(cycle.result).toBeDefined();
    expect(cycle.result.mode).toBeDefined();
    expect(typeof cycle.markdown).toBe("string");
  });

  test("registered CLI dispatch for smart-task commands", async () => {
    const res = await execute([
      "smart-task:ingest",
      "--prompt",
      "Implement memory cache for session states",
      "--id",
      "task-mem-cache",
    ]);

    expect(res.task).toBeDefined();

    const synthRes = await execute(["smart-task:plan", "--max-tasks", "1"]);
    expect(synthRes.mode).toBeDefined();
  });
});
