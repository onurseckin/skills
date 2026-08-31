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

  it("enqueues new task and persists correctly to JSONL", () => {
    setup();
    const task = enqueueTask(
      {
        id: "task-alpha",
        title: "Alpha Task",
        description: "Alpha task description",
        priority: "HIGH",
        write_scope: ["olt/scripts/src/mind/alpha.ts"],
        gate: "bun test tests/mind && bun run typecheck",
        charter_goals: ["G1"],
        acceptance_criteria: ["Must pass all gates"],
      },
      queuePath,
    );

    expect(task.id).toBe("task-alpha");
    expect(task.status).toBe("PENDING");
    expect(task.priority).toBe("HIGH");
    expect(task.blocked_by).toEqual([]);
    expect(task.lease).toBeNull();
    expect(task.retry_count).toBe(0);

    const items = readTaskQueue(queuePath);
    expect(items.length).toBe(1);
    expect(items[0]!.id).toBe("task-alpha");
    expect(items[0]!.status).toBe("PENDING");
    teardown();
  });

  it("refuses corrupt durable records instead of filtering or defaulting them", () => {
    setup();
    const malformed = [
      { id: "bad-status", status: "UNKNOWN" },
      { id: "bad-scope", status: "PENDING", write_scope: "src/file.ts" },
      { id: "bad-retry", status: "PENDING", retry_count: 1.5 },
      {
        id: "bad-lease",
        status: "IN_PROGRESS",
        write_scope: ["src/file.ts"],
        lease: { agent_id: "agent", token: "", attempt: 1, leased_at: "bad", expires_at: "bad" },
      },
    ];
    for (const record of malformed) {
      writeFileSync(queuePath, `${JSON.stringify(record)}\n`, "utf8");
      expect(() => readTaskQueue(queuePath)).toThrow(HarnessError);
    }
    writeFileSync(queuePath, "{not-json}\n", "utf8");
    expect(() => readTaskQueue(queuePath)).toThrow(HarnessError);
    teardown();
  });

  it("refuses a symlink queue without changing its sentinel target", () => {
    setup();
    const sentinel = join(testDir, "sentinel.jsonl");
    writeFileSync(sentinel, "sentinel\n", "utf8");
    symlinkSync(sentinel, queuePath);
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
    expect(readFileSync(sentinel, "utf8")).toBe("sentinel\n");
    teardown();
  });

  it("refuses a hardlinked queue without changing either name", () => {
    setup();
    const sibling = join(testDir, "queue-alias.jsonl");
    writeFileSync(queuePath, "sentinel\n", "utf8");
    linkSync(queuePath, sibling);
    expect(() => readTaskQueue(queuePath)).toThrow(HarnessError);
    expect(readFileSync(queuePath, "utf8")).toBe("sentinel\n");
    expect(readFileSync(sibling, "utf8")).toBe("sentinel\n");
    teardown();
  });

  it("preserves previous bytes when a durable write, fsync, or rename stage fails", () => {
    setup();
    enqueueTask(
      { id: "prior", title: "Prior", write_scope: ["prior.ts"], gate: "gate" },
      queuePath,
    );
    const priorBytes = readFileSync(queuePath, "utf8");
    for (const stage of ["before_write", "before_fsync", "before_rename"] as const) {
      __setTaskQueuePersistenceTestHook((actual) => {
        if (actual === stage) throw new HarnessError("INTEGRITY", `injected ${stage}`);
      });
      expect(() =>
        enqueueTask(
          {
            id: `fails-${stage}`,
            title: "Fails",
            write_scope: ["fails.ts"],
            gate: "gate",
          },
          queuePath,
        ),
      ).toThrow(HarnessError);
      expect(readFileSync(queuePath, "utf8")).toBe(priorBytes);
    }
    __setTaskQueuePersistenceTestHook(undefined);
    teardown();
  });

  it("fails closed with outcome-uncertain integrity after rename or directory fsync failure", () => {
    setup();
    for (const stage of ["after_rename", "before_directory_fsync"] as const) {
      clearTaskQueue(queuePath);
      enqueueTask(
        { id: "prior", title: "Prior", write_scope: ["prior.ts"], gate: "gate" },
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
      expect(readTaskQueue(queuePath).map((item) => item.id)).toEqual([
        "prior",
        `uncertain-${stage}`,
      ]);
    }
    teardown();
  });

  it("retains distinct enqueues from two child processes", async () => {
    setup();
    const modulePath = resolve(process.cwd(), "olt/scripts/src/task/queue/index.ts");
    const program = `import { enqueueTask } from ${JSON.stringify(modulePath)};
      enqueueTask({ id: process.env.TASK_ID, title: process.env.TASK_ID, write_scope: [process.env.TASK_ID + '.ts'], gate: 'gate' }, process.env.QUEUE_PATH);`;
    const first = spawnQueueChild(program, { QUEUE_PATH: queuePath, TASK_ID: "child-one" });
    const second = spawnQueueChild(program, { QUEUE_PATH: queuePath, TASK_ID: "child-two" });
    expect(await first.exited).toBe(0);
    expect(await second.exited).toBe(0);
    expect(
      readTaskQueue(queuePath)
        .map((item) => item.id)
        .sort(),
    ).toEqual(["child-one", "child-two"]);
    teardown();
  });

  it("allows exactly one child process to pop and lease one eligible task", async () => {
    setup();
    enqueueTask({ id: "only", title: "Only", write_scope: ["only.ts"], gate: "gate" }, queuePath);
    const modulePath = resolve(process.cwd(), "olt/scripts/src/task/queue/index.ts");
    const program = `import { popNextEligibleTask } from ${JSON.stringify(modulePath)};
      const result = popNextEligibleTask({ agentId: process.env.AGENT_ID, customPath: process.env.QUEUE_PATH });
      console.log(result ? result.leaseToken : 'none');`;
    const first = spawnQueueChild(program, { QUEUE_PATH: queuePath, AGENT_ID: "child-a" });
    const second = spawnQueueChild(program, { QUEUE_PATH: queuePath, AGENT_ID: "child-b" });
    const outputs = await Promise.all([
      new Response(first.stdout).text(),
      new Response(second.stdout).text(),
      first.exited,
      second.exited,
    ]);
    expect(outputs[2]).toBe(0);
    expect(outputs[3]).toBe(0);
    expect([outputs[0].trim(), outputs[1].trim()].filter((value) => value !== "none")).toHaveLength(
      1,
    );
    expect(readTaskQueue(queuePath)[0]!.status).toBe("IN_PROGRESS");
    teardown();
  });

  it("cleans completed work and claims the next task in one serialized snapshot", () => {
    setup();
    enqueueTask({ id: "done", title: "Done", write_scope: ["done.ts"], gate: "gate" }, queuePath);
    completeTask({ taskId: "done", customPath: queuePath });
    enqueueTask({ id: "next", title: "Next", write_scope: ["next.ts"], gate: "gate" }, queuePath);
    const claimed = popNextEligibleTaskWithCleanup({ agentId: "claimer", customPath: queuePath });
    expect(claimed?.task.id).toBe("next");
    expect(claimed?.prunedCount).toBe(1);
    expect(readTaskQueue(queuePath).map((item) => item.id)).toEqual(["next"]);
    expect(popNextEligibleTask({ agentId: "contender", customPath: queuePath })).toBeNull();
    teardown();
  });

});
