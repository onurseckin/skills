import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  admitTask,
  claimTaskLease,
  completeTask,
  enqueueTask,
  enqueueTasksBatch,
  escalateTask,
  failTask,
  getQueueStats,
  listTaskQueue,
  popNextEligibleTask,
  pruneCompletedTasks,
  readTaskQueue,
  startTaskValidation,
  withTaskQueueTransaction,
} from "../../../olt/scripts/src/task/queue/index.ts";
import { cleanupVirtualTaskFS, scratchRoot, setupVirtualTaskFS } from "../task-fixture.ts";

describe("Stateful Task Queue Engine", () => {
  let testDir = "";
  let queuePath = "";

  beforeEach(() => {
    setupVirtualTaskFS();
    testDir = scratchRoot(import.meta.path, "concurrency");
    queuePath = join(testDir, "TASK_QUEUE.jsonl");
  });

  afterEach(() => {
    cleanupVirtualTaskFS();
  });

  it("computes stats, lists tasks with filters, and prunes completed tasks", () => {
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
  });

  it("admitTask transitions PENDING task to ADMITTED status and records metadata", () => {
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
  });

  it("popNextEligibleTask claims ADMITTED tasks with high priority", () => {
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
  });

  it("startTaskValidation transitions leased task to VALIDATING state", () => {
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
  });

  it("escalateTask transitions task to ESCALATED and marks dependents as BLOCKED", () => {
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
  });

  it("failTask with escalateOnMaxRetries triggers escalation when retries exhausted", () => {
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
  });

  it("enforces atomic lease contention rejecting conflicting concurrent agent claims", () => {
    enqueueTask(
      {
        id: "task-race-1",
        title: "Race Task",
        write_scope: ["src/race.ts"],
        gate: "bun test",
      },
      queuePath,
    );

    const claimA = claimTaskLease({
      taskId: "task-race-1",
      agentId: "agent-alpha",
      customPath: queuePath,
    });
    expect(claimA.task.status).toBe("IN_PROGRESS");
    expect(claimA.task.lease?.agent_id).toBe("agent-alpha");

    expect(() =>
      claimTaskLease({
        taskId: "task-race-1",
        agentId: "agent-beta",
        customPath: queuePath,
      }),
    ).toThrow("actively leased to agent 'agent-alpha'");
  });

  it("aborts withTaskQueueTransaction preserving pre-transaction queue state on error", () => {
    enqueueTask(
      { id: "task-stable-tx", title: "Stable", write_scope: ["src/tx.ts"], gate: "bun test" },
      queuePath,
    );

    expect(() =>
      withTaskQueueTransaction(queuePath, () => {
        throw new Error("Simulated transaction abort");
      }),
    ).toThrow("Simulated transaction abort");

    const queue = readTaskQueue(queuePath);
    expect(queue.some((t) => t.id === "task-stable-tx")).toBe(true);
  });
});
