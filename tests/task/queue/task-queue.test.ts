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
import { scratchRoot } from "../../../support/scratch-root.ts";

describe("Stateful Task Queue Engine", () => {
  const testDir = scratchRoot(import.meta.path, "test-task-queue");
  const queuePath = join(testDir, "TASK_QUEUE.jsonl");

  function setup() {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  }

  function teardown() {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  function spawnQueueChild(
    program: string,
    env: Record<string, string>,
  ): Bun.Subprocess<"pipe", "pipe", "inherit"> {
    return Bun.spawn(["bun", "-e", program], {
      cwd: process.cwd(),
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
        gate: "bun test tests/unit/mind && bun run typecheck",
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
          gate: "bun test tests/unit/task/queue/task-queue.test.ts",
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

  it("computes stats, lists tasks with filters, and prunes completed tasks", () => {
    setup();
    enqueueTasksBatch(
      [
        {
          id: "t1",
          title: "T1",
          priority: "CRITICAL",
          write_scope: ["src/t1.ts"],
          gate: "bun test",
        },
        {
          id: "t2",
          title: "T2",
          priority: "LOW",
          write_scope: ["src/t2.ts"],
          gate: "bun test",
        },
      ],
      queuePath,
    );

    completeTask({ taskId: "t1", customPath: queuePath });

    const stats = getQueueStats(queuePath);
    expect(stats.total).toBe(2);
    expect(stats.completed).toBe(1);
    expect(stats.pending).toBe(1);

    const pendingList = listTaskQueue({ status: "PENDING", customPath: queuePath });
    expect(pendingList.length).toBe(1);
    expect(pendingList[0]!.id).toBe("t2");

    const pruneResult = pruneCompletedTasks(queuePath);
    expect(pruneResult.prunedCount).toBe(1);
    expect(pruneResult.remainingCount).toBe(1);

    const remaining = readTaskQueue(queuePath);
    expect(remaining.length).toBe(1);
    expect(remaining[0]!.id).toBe("t2");
    teardown();
  });

  it("admitTask transitions PENDING task to ADMITTED status and records metadata", () => {
    setup();
    enqueueTask(
      {
        id: "task-admit-1",
        title: "Admit Test",
        write_scope: ["src/admit.ts"],
        gate: "bun test",
      },
      queuePath,
    );

    const admitted = admitTask({
      taskId: "task-admit-1",
      admittedBy: "agent-mind-lead",
      customPath: queuePath,
    });

    expect(admitted.status).toBe("ADMITTED");
    expect(admitted.metadata?.["admitted_by"]).toBe("agent-mind-lead");
    expect(admitted.metadata?.["admitted_at"]).toBeDefined();

    const stats = getQueueStats(queuePath);
    expect(stats.admitted).toBe(1);
    expect(stats.pending).toBe(0);
    teardown();
  });

  it("popNextEligibleTask claims ADMITTED tasks with high priority", () => {
    setup();
    enqueueTask(
      {
        id: "task-pending-low",
        title: "Low Pending",
        priority: "LOW",
        write_scope: ["src/low.ts"],
        gate: "bun test",
      },
      queuePath,
    );

    enqueueTask(
      {
        id: "task-admitted-crit",
        title: "Critical Admitted",
        priority: "CRITICAL",
        write_scope: ["src/crit.ts"],
        gate: "bun test",
      },
      queuePath,
    );

    admitTask({ taskId: "task-admitted-crit", customPath: queuePath });

    const popped = popNextEligibleTask({
      agentId: "worker-1",
      customPath: queuePath,
    });

    expect(popped).not.toBeNull();
    expect(popped!.task.id).toBe("task-admitted-crit");
    expect(popped!.task.status).toBe("IN_PROGRESS");
    teardown();
  });

  it("startTaskValidation transitions leased task to VALIDATING state", () => {
    setup();
    enqueueTask(
      {
        id: "task-validate-1",
        title: "Validation Test",
        write_scope: ["src/val.ts"],
        gate: "bun test",
      },
      queuePath,
    );

    const claim = claimTaskLease({
      taskId: "task-validate-1",
      agentId: "agent-builder",
      customPath: queuePath,
    });

    const validating = startTaskValidation({
      taskId: "task-validate-1",
      agentId: "agent-builder",
      leaseToken: claim.leaseToken,
      customPath: queuePath,
    });

    expect(validating.status).toBe("VALIDATING");

    const stats = getQueueStats(queuePath);
    expect(stats.validating).toBe(1);

    const comp = completeTask({
      taskId: "task-validate-1",
      agentId: "agent-builder",
      leaseToken: claim.leaseToken,
      customPath: queuePath,
    });
    expect(comp.completedTask.status).toBe("COMPLETED");
    teardown();
  });

  it("escalateTask transitions task to ESCALATED and marks dependents as BLOCKED", () => {
    setup();
    enqueueTasksBatch(
      [
        {
          id: "task-blocked-by-esc",
          title: "Dependent of Escalation",
          write_scope: ["src/dep.ts"],
          gate: "bun test",
          dependencies: ["task-to-escalate"],
        },
        {
          id: "task-to-escalate",
          title: "Root Task To Escalate",
          write_scope: ["src/esc.ts"],
          gate: "bun test",
        },
      ],
      queuePath,
    );

    const escResult = escalateTask({
      taskId: "task-to-escalate",
      reason: "Critical architectural ambiguity requiring human lead review",
      escalationTier: "Tier_0_Mind",
      agentId: "coord-lead",
      customPath: queuePath,
    });

    expect(escResult.task.status).toBe("ESCALATED");
    expect(escResult.task.error_message).toContain("Critical architectural ambiguity");
    expect(escResult.task.assigned_tier).toBe("Tier_0_Mind");
    expect(escResult.affectedDependents).toContain("task-blocked-by-esc");

    const queue = readTaskQueue(queuePath);
    const dep = queue.find((t) => t.id === "task-blocked-by-esc")!;
    expect(dep.status).toBe("BLOCKED");
    expect(dep.blocked_by).toContain("task-to-escalate");

    const stats = getQueueStats(queuePath);
    expect(stats.escalated).toBe(1);
    expect(stats.blocked).toBe(1);
    teardown();
  });

  it("failTask with escalateOnMaxRetries triggers escalation when retries exhausted", () => {
    setup();
    enqueueTask(
      {
        id: "task-fail-esc",
        title: "Flaky Task with Escalate",
        write_scope: ["src/flaky.ts"],
        gate: "bun test",
        max_retries: 1,
      },
      queuePath,
    );

    const r1 = failTask({
      taskId: "task-fail-esc",
      errorMessage: "First fail",
      escalateOnMaxRetries: true,
      customPath: queuePath,
    });
    expect(r1.retried).toBe(true);
    expect(r1.escalated).toBe(false);

    const r2 = failTask({
      taskId: "task-fail-esc",
      errorMessage: "Second fail permanent",
      escalateOnMaxRetries: true,
      customPath: queuePath,
    });
    expect(r2.retried).toBe(false);
    expect(r2.escalated).toBe(true);
    expect(r2.task.status).toBe("ESCALATED");
    teardown();
  });
});

describe("Static Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
  it("verifies task-queue.ts and smart-task-ops.ts contain zero any and zero suppressions", () => {
    const filesToAudit = [
      resolve(process.cwd(), "olt/scripts/src/task/queue/index.ts"),
      resolve(process.cwd(), "olt/scripts/src/cli/commands/smart-task-ops.ts"),
      resolve(process.cwd(), "tests/unit/task/queue/task-queue.test.ts"),
    ];

    const anyPattern = new RegExp(":\\s*any\\b|as\\s+any\\b|<any>");
    const suppressionPattern = new RegExp(
      [
        "@ts" + "-ignore",
        "@ts" + "-expect-error",
        "@ts" + "-nocheck",
        "eslint" + "-disable",
        "oxlint" + "-disable",
      ].join("|"),
    );

    for (const filePath of filesToAudit) {
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (line.includes("anyPattern") || line.includes("suppressionPattern")) continue;

        expect(anyPattern.test(line)).toBe(false);
        expect(suppressionPattern.test(line)).toBe(false);
      }
    }
  });
});
