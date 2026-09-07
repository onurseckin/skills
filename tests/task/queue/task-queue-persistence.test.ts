import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  __setTaskQueuePersistenceTestHook,
  claimTaskLease,
  completeTask,
  enqueueTask,
  popNextEligibleTask,
  popNextEligibleTaskWithCleanup,
  readTaskQueue,
} from "../../../olt/scripts/src/task/queue/index.ts";
import {
  cleanupVirtualTaskFS,
  createVirtualHardlink,
  createVirtualSymlink,
  getVirtualTaskFS,
  scratchRoot,
  setupVirtualTaskFS,
} from "../task-fixture.ts";

describe("Stateful Task Queue Engine", () => {
  let testDir = "";
  let queuePath = "";
  const vfs = getVirtualTaskFS();

  beforeEach(() => {
    setupVirtualTaskFS();
    testDir = scratchRoot(import.meta.path, "test-task-queue");
    queuePath = join(testDir, "TASK_QUEUE.jsonl");
  });

  afterEach(() => {
    cleanupVirtualTaskFS();
  });

  it("enqueues new task and persists correctly to JSONL", () => {
    const task = enqueueTask(
      {
        id: "task-alpha",
        title: "Alpha Task",
        description: "Alpha task description",
        write_scope: ["src/alpha.ts"],
        gate: "bun test tests/alpha.test.ts",
      },
      queuePath,
    );

    expect(task.id).toBe("task-alpha");
    expect(task.status).toBe("PENDING");
    expect(vfs.existsSync(queuePath)).toBe(true);

    const items = readTaskQueue(queuePath);
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe("task-alpha");
    expect(items[0]!.title).toBe("Alpha Task");
    expect(items[0]!.gate).toBe("bun test tests/alpha.test.ts");
  });

  it("claims task lease with leaseToken and expiresAt timestamps", () => {
    enqueueTask(
      {
        id: "task-claimable",
        title: "Claimable Task",
        write_scope: ["src/claimable.ts"],
        gate: "bun test tests/claimable.test.ts",
      },
      queuePath,
    );

    const leaseResult = claimTaskLease({
      taskId: "task-claimable",
      agentId: "agent-prime",
      customPath: queuePath,
      leaseDurationSeconds: 15,
    });

    expect(leaseResult).not.toBeNull();
    expect(leaseResult?.task.status).toBe("IN_PROGRESS");
    expect(leaseResult?.task.lease?.agent_id).toBe("agent-prime");
    expect(leaseResult?.leaseToken).toBeDefined();
    expect(leaseResult?.task.lease?.expires_at).toBeDefined();

    const items = readTaskQueue(queuePath);
    expect(items[0]!.status).toBe("IN_PROGRESS");
    expect(items[0]!.lease?.agent_id).toBe("agent-prime");
  });

  it("refuses to claim non-existent or un-claimable task", () => {
    expect(() =>
      claimTaskLease({
        taskId: "non-existent",
        agentId: "agent-prime",
        customPath: queuePath,
      }),
    ).toThrow(HarnessError);
  });

  it("handles corrupted JSONL lines safely without corrupting entire queue", () => {
    enqueueTask(
      {
        id: "task-valid-01",
        title: "Valid Task 1",
        write_scope: ["src/valid1.ts"],
        gate: "bun test tests/valid1.test.ts",
      },
      queuePath,
    );

    for (const stage of [
      "before_write",
      "before_fsync",
      "before_rename",
      "after_rename",
      "before_directory_fsync",
    ] as const) {
      vfs.writeFileSync(queuePath, "{not-json}\n");
      expect(() =>
        enqueueTask(
          {
            id: `broken-${stage}`,
            title: "Broken",
            write_scope: ["broken.ts"],
            gate: "gate",
          },
          queuePath,
        ),
      ).toThrow(HarnessError);
    }
    vfs.writeFileSync(queuePath, "{not-json}\n");
    expect(() => readTaskQueue(queuePath)).toThrow(HarnessError);
  });

  it("refuses a symlink queue without changing its sentinel target", () => {
    const sentinel = join(testDir, "sentinel.jsonl");
    vfs.writeFileSync(sentinel, "sentinel\n");
    createVirtualSymlink(sentinel, queuePath);
    expect(() =>
      enqueueTask(
        {
          id: "must-not-write",
          title: "Must not write",
          write_scope: ["src/safe.ts"],
          gate: "bun test tests/task/queue/task-queue.test.ts",
        },
        queuePath,
      ),
    ).toThrow(HarnessError);
    expect(vfs.readFileSync(sentinel, "utf8")).toBe("sentinel\n");
  });

  it("refuses a hardlinked queue without changing either name", () => {
    const sibling = join(testDir, "queue-alias.jsonl");
    vfs.writeFileSync(queuePath, "sentinel\n");
    createVirtualHardlink(queuePath, sibling);
    expect(() => readTaskQueue(queuePath)).toThrow(HarnessError);
    expect(vfs.readFileSync(queuePath, "utf8")).toBe("sentinel\n");
    expect(vfs.readFileSync(sibling, "utf8")).toBe("sentinel\n");
  });

  it("preserves previous bytes when a durable write, fsync, or rename stage fails", () => {
    enqueueTask(
      { id: "prior", title: "Prior", write_scope: ["prior.ts"], gate: "gate" },
      queuePath,
    );
    for (const stage of ["before_write", "before_fsync", "before_rename"] as const) {
      __setTaskQueuePersistenceTestHook((actual) => {
        if (actual === stage) throw new Error(`injected ${stage}`);
      });
      expect(() =>
        enqueueTask(
          {
            id: `rollback-${stage}`,
            title: "Rollback",
            write_scope: ["rollback.ts"],
            gate: "gate",
          },
          queuePath,
        ),
      ).toThrow(`injected ${stage}`);
      __setTaskQueuePersistenceTestHook(undefined);
      expect(readTaskQueue(queuePath).map((item) => item.id)).toEqual(["prior"]);
    }
  });

  it("surfaces uncertain committed state when post-rename directory synchronization fails", () => {
    for (const stage of ["after_rename", "before_directory_fsync"] as const) {
      enqueueTask(
        { id: `prior-${stage}`, title: "Prior", write_scope: ["prior.ts"], gate: "gate" },
        queuePath,
      );
      __setTaskQueuePersistenceTestHook((actual) => {
        if (actual === stage) throw new Error(`injected ${stage}`);
      });
      expect(() =>
        enqueueTask(
          {
            id: `uncertain-${stage}`,
            title: "Uncertain",
            write_scope: ["uncertain.ts"],
            gate: "gate",
          },
          queuePath,
        ),
      ).toThrow("outcome is uncertain and possibly committed");
      __setTaskQueuePersistenceTestHook(undefined);
      expect(readTaskQueue(queuePath).map((item) => item.id)).toContain(`uncertain-${stage}`);
    }
  });

  it("retains distinct enqueues from two concurrent async operations", async () => {
    await Promise.all([
      Promise.resolve().then(() =>
        enqueueTask({ id: "child-one", title: "1", write_scope: ["1.ts"], gate: "g" }, queuePath),
      ),
      Promise.resolve().then(() =>
        enqueueTask({ id: "child-two", title: "2", write_scope: ["2.ts"], gate: "g" }, queuePath),
      ),
    ]);
    expect(
      readTaskQueue(queuePath)
        .map((item) => item.id)
        .sort(),
    ).toEqual(["child-one", "child-two"]);
  });

  it("allows exactly one concurrent worker to pop and lease one eligible task", async () => {
    enqueueTask({ id: "only", title: "Only", write_scope: ["only.ts"], gate: "gate" }, queuePath);
    const results = await Promise.all([
      Promise.resolve().then(() =>
        popNextEligibleTask({ agentId: "child-a", customPath: queuePath }),
      ),
      Promise.resolve().then(() =>
        popNextEligibleTask({ agentId: "child-b", customPath: queuePath }),
      ),
    ]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(readTaskQueue(queuePath)[0]!.status).toBe("IN_PROGRESS");
  });

  it("cleans completed work and claims the next task in one serialized snapshot", () => {
    enqueueTask({ id: "done", title: "Done", write_scope: ["done.ts"], gate: "gate" }, queuePath);
    completeTask({ taskId: "done", customPath: queuePath });
    enqueueTask({ id: "next", title: "Next", write_scope: ["next.ts"], gate: "gate" }, queuePath);
    const claimed = popNextEligibleTaskWithCleanup({ agentId: "claimer", customPath: queuePath });
    expect(claimed?.task.id).toBe("next");
    expect(claimed?.prunedCount).toBe(1);
    expect(readTaskQueue(queuePath).map((item) => item.id)).toEqual(["next"]);
    expect(popNextEligibleTask({ agentId: "contender", customPath: queuePath })).toBeNull();
  });

  it("safely skips whitespace lines and strictly rejects malformed or truncated JSON lines", () => {
    enqueueTask({ id: "valid-1", title: "Valid 1", write_scope: ["1.ts"], gate: "g" }, queuePath);
    enqueueTask({ id: "valid-2", title: "Valid 2", write_scope: ["2.ts"], gate: "g" }, queuePath);

    const raw = vfs.readFileSync(queuePath, "utf8");
    const withWhitespace = raw.replace("\n", "\n   \n\n");
    vfs.writeFileSync(queuePath, withWhitespace);

    const items = readTaskQueue(queuePath);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.id)).toEqual(["valid-1", "valid-2"]);

    vfs.writeFileSync(queuePath, withWhitespace + '{"id": "truncated"\n');
    expect(() => readTaskQueue(queuePath)).toThrow(HarnessError);
  });
});
