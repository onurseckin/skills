import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import {
  claimTaskLease,
  completeTask,
  completeTaskUnlocked,
  enqueueTask,
  readTaskQueue,
  type TaskQueueItem,
} from "../../olt/scripts/src/task/queue/index.ts";
import { cleanupVirtualTaskFS, scratchRoot, setupVirtualTaskFS } from "./task-fixture.ts";

describe("queue-completion-coverage", () => {
  let queuePath: string;
  let archivePath: string;
  let testDir: string;

  function add(id: string, deps?: string[]) {
    enqueueTask(
      {
        id,
        title: id,
        priority: "HIGH",
        dependencies: deps,
        write_scope: ["src/a.ts"],
        gate: "bun test",
      },
      queuePath,
    );
  }

  beforeEach(() => {
    setupVirtualTaskFS();
    testDir = scratchRoot(import.meta.path, "completion");
    queuePath = join(testDir, "TASK_QUEUE.jsonl");
    archivePath = join(testDir, "COMPLETED_TASKS.jsonl");
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
    writeFileSync(archivePath, "");
  });

  afterEach(() => {
    cleanupVirtualTaskFS();
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it("handles receipt validation errors and missing tasks", () => {
    expect(() =>
      completeTaskUnlocked(
        { taskId: "t1", receipts: { exit_code: 1, cognitive_verdict: "PASS" } },
        queuePath,
      ),
    ).toThrow(HarnessError);

    expect(() =>
      completeTaskUnlocked(
        { taskId: "t1", receipts: { exit_code: 0, cognitive_verdict: "FAIL" } },
        queuePath,
      ),
    ).toThrow(HarnessError);

    writeFileSync(queuePath, "");
    expect(() => completeTaskUnlocked({ taskId: "missing-task" }, queuePath)).toThrow(HarnessError);
  });

  it("handles idempotent completion and lease token validation", () => {
    add("t-idemp");
    const lease = claimTaskLease({ taskId: "t-idemp", agentId: "agent-1", customPath: queuePath });

    expect(() =>
      completeTaskUnlocked({ taskId: "t-idemp", leaseToken: "wrong" }, queuePath),
    ).toThrow(HarnessError);

    const first = completeTaskUnlocked(
      { taskId: "t-idemp", leaseToken: lease.leaseToken, nowIso: "2026-09-01T12:00:00.000Z" },
      queuePath,
    );
    expect(first.completedTask.status).toBe("COMPLETED");
    expect(first.completedTask.completed_at).toBe("2026-09-01T12:00:00.000Z");

    const second = completeTaskUnlocked({ taskId: "t-idemp" }, queuePath);
    expect(second.completedTask.status).toBe("COMPLETED");
    expect(second.unblockedTasks).toEqual([]);
  });

  it("unblocks dependent tasks and transitions BLOCKED status to PENDING", () => {
    add("parent-1");
    add("c1", ["parent-1"]);
    add("c2", ["parent-1", "other"]);

    const res = completeTaskUnlocked({ taskId: "parent-1" }, queuePath);
    expect(res.unblockedTasks.length).toBe(1);
    expect(res.unblockedTasks[0]?.id).toBe("c1");
    expect(res.unblockedTasks[0]?.status).toBe("PENDING");

    const queue = readTaskQueue(queuePath);
    const c2 = queue.find((t) => t.id === "c2") as TaskQueueItem;
    expect(c2.status).toBe("BLOCKED");
    expect(c2.blocked_by).toEqual(["other"]);
  });

  it("archives completed tasks and falls back on metadata / proof summary", () => {
    enqueueTask(
      {
        id: "t-arc",
        title: "Arc",
        description: "Task desc",
        priority: "MEDIUM",
        write_scope: ["src/m.ts"],
        gate: "bun test",
        metadata: {
          category: "ENGINE",
          test_path: "tests/m.test.ts",
          assertions: 10,
          runtime_ms: 250,
          commit_sha: "sha123",
        },
      },
      queuePath,
    );

    const res = completeTaskUnlocked(
      { taskId: "t-arc", autoArchive: true, completedTasksPath: archivePath },
      queuePath,
    );
    expect(res.archivedRecord?.proof_summary).toBe("Task desc");
    expect(res.archivedRecord?.category).toBe("ENGINE");
    expect(res.archivedRecord?.test_path).toBe("tests/m.test.ts");

    add("t-arc-fb");
    const resFb = completeTaskUnlocked(
      {
        taskId: "t-arc-fb",
        receipts: { proof_summary: "Receipt proof" },
        completedTasksPath: archivePath,
      },
      queuePath,
    );
    expect(resFb.archivedRecord?.proof_summary).toBe("Receipt proof");
  });

  it("handles autoPrune and archiving failure resilience", () => {
    add("t-prune");
    const resPrune = completeTaskUnlocked(
      {
        taskId: "t-prune",
        autoPrune: true,
        autoArchive: true,
        completedTasksPath: "/invalid\0path/archive.jsonl",
      },
      queuePath,
    );
    expect(resPrune.completedTask.id).toBe("t-prune");
    expect(readTaskQueue(queuePath).find((t) => t.id === "t-prune")).toBeUndefined();
  });

  it("executes completeTask transactional entrypoint and polymorphic overloads", () => {
    add("t-tx-1");
    expect(completeTask({ taskId: "t-tx-1", customPath: queuePath }).completedTask.status).toBe(
      "COMPLETED",
    );

    add("t-tx-2");
    const lease = claimTaskLease({ taskId: "t-tx-2", agentId: "agent-str", customPath: queuePath });
    expect(completeTask("t-tx-2", lease.leaseToken, queuePath).completedTask.status).toBe(
      "COMPLETED",
    );

    add("t-tx-3");
    expect(
      completeTask("t-tx-3", { proof_summary: "Receipt" }, undefined, queuePath).completedTask
        .status,
    ).toBe("COMPLETED");
  });
});
