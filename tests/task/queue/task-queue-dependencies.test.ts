import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  claimTaskLease,
  completeTask,
  enqueueTask,
  enqueueTasksBatch,
  readTaskQueue,
} from "../../../olt/scripts/src/task/queue/index.ts";
import { cleanupVirtualTaskFS, scratchRoot, setupVirtualTaskFS } from "../task-fixture.ts";

describe("Stateful Task Queue Engine", () => {
  let testDir = "";
  let queuePath = "";

  beforeEach(() => {
    setupVirtualTaskFS();
    testDir = scratchRoot(import.meta.path, "dependencies");
    queuePath = join(testDir, "TASK_QUEUE.jsonl");
  });

  afterEach(() => {
    cleanupVirtualTaskFS();
  });

  it("refuses duplicate task IDs", () => {
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
  });

  it("refuses self-referential dependencies", () => {
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
  });

  it("correctly marks tasks as BLOCKED when depending on incomplete tasks", () => {
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
  });

  it("detects and rejects circular dependencies across batch enqueue", () => {
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
  });

  it("claims task lease with lease token and expires_at", () => {
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
  });

  it("unblocks transitive dependency chain step-by-step", () => {
    enqueueTasksBatch(
      [
        { id: "t0", title: "T0", write_scope: ["src/0.ts"], gate: "bun test" },
        {
          id: "t1",
          title: "T1",
          write_scope: ["src/1.ts"],
          gate: "bun test",
          dependencies: ["t0"],
        },
        {
          id: "t2",
          title: "T2",
          write_scope: ["src/2.ts"],
          gate: "bun test",
          dependencies: ["t1"],
        },
      ],
      queuePath,
    );

    const initial = readTaskQueue(queuePath);
    expect(initial.find((t) => t.id === "t1")?.status).toBe("BLOCKED");
    expect(initial.find((t) => t.id === "t2")?.status).toBe("BLOCKED");

    const comp0 = completeTask({ taskId: "t0", customPath: queuePath });
    expect(comp0.unblockedTasks.map((t) => t.id)).toEqual(["t1"]);

    const after0 = readTaskQueue(queuePath);
    expect(after0.find((t) => t.id === "t1")?.status).toBe("PENDING");
    expect(after0.find((t) => t.id === "t2")?.status).toBe("BLOCKED");

    const comp1 = completeTask({ taskId: "t1", customPath: queuePath });
    expect(comp1.unblockedTasks.map((t) => t.id)).toEqual(["t2"]);

    const after1 = readTaskQueue(queuePath);
    expect(after1.find((t) => t.id === "t2")?.status).toBe("PENDING");
  });

  it("unblocks multiple parallel diamond children simultaneously upon parent completion", () => {
    enqueueTasksBatch(
      [
        { id: "t-parent", title: "Parent", write_scope: ["src/p.ts"], gate: "bun test" },
        {
          id: "t-child-a",
          title: "Child A",
          write_scope: ["src/ca.ts"],
          gate: "bun test",
          dependencies: ["t-parent"],
        },
        {
          id: "t-child-b",
          title: "Child B",
          write_scope: ["src/cb.ts"],
          gate: "bun test",
          dependencies: ["t-parent"],
        },
      ],
      queuePath,
    );

    const comp = completeTask({ taskId: "t-parent", customPath: queuePath });
    expect(comp.unblockedTasks).toHaveLength(2);
    expect(comp.unblockedTasks.map((t) => t.id).sort()).toEqual(["t-child-a", "t-child-b"]);

    const queue = readTaskQueue(queuePath);
    expect(queue.find((t) => t.id === "t-child-a")?.status).toBe("PENDING");
    expect(queue.find((t) => t.id === "t-child-b")?.status).toBe("PENDING");
  });

  it("ensures diamond join task remains BLOCKED until all parallel prerequisites complete", () => {
    enqueueTasksBatch(
      [
        { id: "t-join-a", title: "Join A", write_scope: ["src/ja.ts"], gate: "bun test" },
        { id: "t-join-b", title: "Join B", write_scope: ["src/jb.ts"], gate: "bun test" },
        {
          id: "t-join-node",
          title: "Join Node",
          write_scope: ["src/jn.ts"],
          gate: "bun test",
          dependencies: ["t-join-a", "t-join-b"],
        },
      ],
      queuePath,
    );

    const compA = completeTask({ taskId: "t-join-a", customPath: queuePath });
    expect(compA.unblockedTasks).toEqual([]);

    const queueMid = readTaskQueue(queuePath);
    const joinMid = queueMid.find((t) => t.id === "t-join-node")!;
    expect(joinMid.status).toBe("BLOCKED");
    expect(joinMid.blocked_by).toEqual(["t-join-b"]);

    const compB = completeTask({ taskId: "t-join-b", customPath: queuePath });
    expect(compB.unblockedTasks.map((t) => t.id)).toEqual(["t-join-node"]);

    const queueEnd = readTaskQueue(queuePath);
    const joinEnd = queueEnd.find((t) => t.id === "t-join-node")!;
    expect(joinEnd.status).toBe("PENDING");
    expect(joinEnd.blocked_by).toEqual([]);
  });
});
