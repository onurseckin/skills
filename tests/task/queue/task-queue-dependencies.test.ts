import { describe, expect, it } from "bun:test";
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  __setTaskQueuePersistenceTestHook,
  admitTask,
  claimTaskLease,
  clearTaskQueue,
  completeTask,
  enqueueTask,
  enqueueTasksBatch,
  escalateTask,
  failTask,
  getQueueStats,
  listTaskQueue,
  popNextEligibleTask,
  popNextEligibleTaskWithCleanup,
  pruneCompletedTasks,
  readTaskQueue,
  reclaimExpiredLeases,
  releaseTaskLease,
  renewTaskLease,
  startTaskValidation,
  validateTaskQueueDag,
  writeTaskQueue,
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

  function spawnQueueChild(
    program: string,
    env: Record<string, string>,
  ): Bun.Subprocess<"pipe", "pipe", "inherit"> {
    return Bun.spawn(["bun", "-e", program], {
      env: { ...process.env, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
  }

  it("refuses duplicate task IDs", () => {
    setup();
    enqueueTask(
      {
        id: "task-dup",
        title: "Duplicate 1",
        write_scope: ["src/dup.ts"],
        gate: "bun test",
      },
      queuePath,
    );

    expect(() => {
      enqueueTask(
        {
          id: "task-dup",
          title: "Duplicate 2",
          write_scope: ["src/dup.ts"],
          gate: "bun test",
        },
        queuePath,
      );
    }).toThrow("already exists in the queue");
    teardown();
  });

  it("refuses self-referential dependencies", () => {
    setup();
    expect(() => {
      enqueueTask(
        {
          id: "task-self",
          title: "Self ref",
          write_scope: ["src/self.ts"],
          gate: "bun test",
          dependencies: ["task-self"],
        },
        queuePath,
      );
    }).toThrow("cannot depend on itself");
    teardown();
  });

  it("correctly marks tasks as BLOCKED when depending on incomplete tasks", () => {
    setup();
    const t1 = enqueueTask(
      {
        id: "task-parent",
        title: "Parent Task",
        write_scope: ["src/parent.ts"],
        gate: "bun test",
      },
      queuePath,
    );

    const t2 = enqueueTask(
      {
        id: "task-child",
        title: "Child Task",
        write_scope: ["src/child.ts"],
        gate: "bun test",
        dependencies: ["task-parent"],
      },
      queuePath,
    );

    expect(t1.status).toBe("PENDING");
    expect(t1.blocked_by).toEqual([]);

    expect(t2.status).toBe("BLOCKED");
    expect(t2.blocked_by).toEqual(["task-parent"]);
    teardown();
  });

  it("detects and rejects circular dependencies across batch enqueue", () => {
    setup();
    expect(() => {
      enqueueTasksBatch(
        [
          {
            id: "task-a",
            title: "Task A",
            write_scope: ["src/a.ts"],
            gate: "bun test",
            dependencies: ["task-b"],
          },
          {
            id: "task-b",
            title: "Task B",
            write_scope: ["src/b.ts"],
            gate: "bun test",
            dependencies: ["task-c"],
          },
          {
            id: "task-c",
            title: "Task C",
            write_scope: ["src/c.ts"],
            gate: "bun test",
            dependencies: ["task-a"],
          },
        ],
        queuePath,
      );
    }).toThrow("circular dependency detected");
    teardown();
  });

  it("claims task lease with lease token and expires_at", () => {
    setup();
    enqueueTask(
      {
        id: "task-lease-1",
        title: "Lease Test",
        write_scope: ["src/lease.ts"],
        gate: "bun test",
      },
      queuePath,
    );

    const claim = claimTaskLease({
      taskId: "task-lease-1",
      agentId: "agent-mind-1",
      durationSeconds: 600,
      customPath: queuePath,
    });

    expect(claim.task.status).toBe("IN_PROGRESS");
    expect(claim.task.lease).toBeDefined();
    expect(claim.task.lease?.agent_id).toBe("agent-mind-1");
    expect(claim.task.lease?.token).toBe(claim.leaseToken);
    expect(claim.task.lease?.lease_duration_seconds).toBe(600);
    expect(claim.task.lease?.attempt).toBe(1);

    // Cannot claim already leased task with different agent
    expect(() => {
      claimTaskLease({
        taskId: "task-lease-1",
        agentId: "agent-mind-2",
        customPath: queuePath,
      });
    }).toThrow("actively leased to agent 'agent-mind-1'");
    teardown();
  });
});
