import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  assertSingleActiveLease,
  dequeueTask,
  admitTask,
  popNextEligibleTask,
  popNextEligibleTaskWithCleanup,
} from "../../../olt/scripts/src/task/queue/dequeue.ts";
import {
  claimTaskLease,
  renewTaskLease,
  releaseTaskLease,
  startTaskValidation,
} from "../../../olt/scripts/src/task/queue/lease.ts";
import { enqueueTask, enqueueTasksBatch } from "../../../olt/scripts/src/task/queue/enqueue.ts";
import { scratchRoot } from "../../../support/scratch-root.ts";

describe("Task Queue Dequeue Engine & Anti-Batching Guard", () => {
  const testDir = scratchRoot(import.meta.path, "test-dequeue-queue");
  const queuePath = join(testDir, "TASK_QUEUE.jsonl");

  beforeEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it("assertSingleActiveLease passes when agent holds no active leases", () => {
    expect(() => assertSingleActiveLease([], "agent-1")).not.toThrow();
  });

  it("assertSingleActiveLease throws INVALID_STATE when agent holds active lease", () => {
    const futureIso = new Date(Date.now() + 60_000).toISOString();
    const task = {
      id: "task-1",
      title: "Task 1",
      description: "Task 1",
      priority: "HIGH" as const,
      status: "IN_PROGRESS" as const,
      write_scope: ["a.ts"],
      gate: "G1",
      charter_goals: ["G1"],
      acceptance_criteria: [],
      dependencies: [],
      blocked_by: [],
      lease: {
        agent_id: "agent-1",
        token: "tok-1",
        leased_at: new Date().toISOString(),
        expires_at: futureIso,
        attempt: 1,
        lease_duration_seconds: 60,
      },
      source_type: "direct_prompt" as const,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      retry_count: 0,
      max_retries: 3,
    };

    expect(() => assertSingleActiveLease([task], "agent-1")).toThrow(HarnessError);
    expect(() => assertSingleActiveLease([task], "agent-2")).not.toThrow();
  });

  it("assertSingleActiveLease ignores expired leases", () => {
    const pastIso = new Date(Date.now() - 60_000).toISOString();
    const task = {
      id: "task-1",
      title: "Task 1",
      description: "Task 1",
      priority: "HIGH" as const,
      status: "IN_PROGRESS" as const,
      write_scope: ["a.ts"],
      gate: "G1",
      charter_goals: ["G1"],
      acceptance_criteria: [],
      dependencies: [],
      blocked_by: [],
      lease: {
        agent_id: "agent-1",
        token: "tok-1",
        leased_at: new Date(Date.now() - 120_000).toISOString(),
        expires_at: pastIso,
        attempt: 1,
        lease_duration_seconds: 60,
      },
      source_type: "direct_prompt" as const,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      retry_count: 0,
      max_retries: 3,
    };

    expect(() => assertSingleActiveLease([task], "agent-1")).not.toThrow();
  });

  it("dequeueTask claims next eligible task in priority order", () => {
    enqueueTask(
      { id: "task-low", title: "Low", priority: "LOW", write_scope: ["a.ts"], gate: "G1" },
      queuePath,
    );
    enqueueTask(
      { id: "task-crit", title: "Crit", priority: "CRITICAL", write_scope: ["b.ts"], gate: "G1" },
      queuePath,
    );

    const dequeued = dequeueTask("agent-worker-1", 300, { customPath: queuePath });
    expect(dequeued).not.toBeNull();
    expect(dequeued?.id).toBe("task-crit");
    expect(dequeued?.status).toBe("IN_PROGRESS");
    expect(dequeued?.lease?.agent_id).toBe("agent-worker-1");
  });

  it("dequeueTask enforces 1:1 anti-batching guard against double lease", () => {
    enqueueTask(
      { id: "task-1", title: "Task 1", priority: "HIGH", write_scope: ["a.ts"], gate: "G1" },
      queuePath,
    );
    enqueueTask(
      { id: "task-2", title: "Task 2", priority: "HIGH", write_scope: ["b.ts"], gate: "G1" },
      queuePath,
    );

    const first = dequeueTask("agent-worker-1", 300, { customPath: queuePath });
    expect(first?.id).toBe("task-1");

    expect(() => dequeueTask("agent-worker-1", 300, { customPath: queuePath })).toThrow(
      /already holds active lease/,
    );

    const other = dequeueTask("agent-worker-2", 300, { customPath: queuePath });
    expect(other?.id).toBe("task-2");
  });

  it("dequeueTask returns null when no eligible unblocked tasks exist", () => {
    enqueueTask(
      { id: "task-parent", title: "Parent", write_scope: ["a.ts"], gate: "G1" },
      queuePath,
    );
    enqueueTask(
      {
        id: "task-child",
        title: "Child",
        dependencies: ["task-parent"],
        write_scope: ["b.ts"],
        gate: "G1",
      },
      queuePath,
    );

    dequeueTask("agent-1", 300, { customPath: queuePath });
    const empty = dequeueTask("agent-2", 300, { customPath: queuePath });
    expect(empty).toBeNull();
  });

  it("popNextEligibleTask and popNextEligibleTaskWithCleanup acquire leases", () => {
    enqueueTask(
      {
        id: "task-cleanup",
        title: "Cleanup",
        priority: "MEDIUM",
        write_scope: ["c.ts"],
        gate: "G1",
      },
      queuePath,
    );
    const popped = popNextEligibleTaskWithCleanup({
      agentId: "agent-cleaner",
      customPath: queuePath,
    });
    expect(popped).not.toBeNull();
    expect(popped?.task.id).toBe("task-cleanup");
    expect(popped?.leaseToken).toMatch(/^lease-/);
  });

  it("admitTask, renewTaskLease, releaseTaskLease, startTaskValidation lifecycle", () => {
    enqueueTask({ id: "task-life", title: "Life", write_scope: ["l.ts"], gate: "G1" }, queuePath);
    admitTask({ taskId: "task-life", admittedBy: "orchestrator", customPath: queuePath });

    const claim = claimTaskLease({
      taskId: "task-life",
      agentId: "agent-life",
      customPath: queuePath,
    });
    expect(claim.task.status).toBe("IN_PROGRESS");

    const renewed = renewTaskLease({
      taskId: "task-life",
      agentId: "agent-life",
      leaseToken: claim.leaseToken,
      extensionSeconds: 600,
      customPath: queuePath,
    });
    expect(renewed.lease?.lease_duration_seconds).toBe(600);

    const validating = startTaskValidation({
      taskId: "task-life",
      agentId: "agent-life",
      leaseToken: claim.leaseToken,
      customPath: queuePath,
    });
    expect(validating.status).toBe("VALIDATING");

    const released = releaseTaskLease({
      taskId: "task-life",
      agentId: "agent-life",
      leaseToken: claim.leaseToken,
      customPath: queuePath,
    });
    expect(released.status).toBe("PENDING");
    expect(released.lease).toBeNull();
  });
});
