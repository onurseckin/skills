import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import {
  claimTaskLease,
  completeTask,
  enqueueTask,
  readTaskQueue,
  validateCompletionReceipts,
} from "../../olt/scripts/src/task/queue/index.ts";
import { cleanupVirtualTaskFS, scratchRoot, setupVirtualTaskFS } from "./task-fixture.ts";

describe("Task Queue Comprehensive Coverage", () => {
  let testDirQueue = "";
  let testDirArchive = "";
  let queuePath = "";
  let completedPath = "";

  beforeEach(() => {
    setupVirtualTaskFS();
    testDirQueue = scratchRoot(import.meta.path, "queue");
    testDirArchive = scratchRoot(import.meta.path, "archive");
    queuePath = join(testDirQueue, "queue", "TASK_QUEUE.jsonl");
    completedPath = join(testDirArchive, "archived", "COMPLETED_TASKS.jsonl");
  });

  afterEach(() => {
    cleanupVirtualTaskFS();
  });

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

  it("covers completeTask and completeTaskUnlocked with all receipt and archive permutations", () => {
    setup();
    enqueueTask(
      {
        id: "task-comp-1",
        title: "Task Comp 1",
        description: "Comp test task",
        priority: "HIGH",
        write_scope: ["src/a.ts"],
        gate: "bun test",
        metadata: {
          category: "TESTING",
          test_path: "tests/a.test.ts",
          assertions: ["5"],
          runtime_ms: "120",
          commit_sha: "abc1234",
        },
      },
      queuePath,
    );

    const leaseRes = claimTaskLease({
      taskId: "task-comp-1",
      agentId: "agent-1",
      customPath: queuePath,
      durationSeconds: 60,
    });

    // Call completeTask using object with autoArchive
    const res1 = completeTask({
      taskId: "task-comp-1",
      leaseToken: leaseRes.leaseToken,
      autoArchive: true,
      completedTasksPath: completedPath,
      proofSummary: "Custom proof summary",
      customPath: queuePath,
    });
    expect(res1.completedTask.status).toBe("COMPLETED");
    expect(res1.archivedRecord).toBeDefined();
    expect(res1.archivedRecord?.proof_summary).toBe("Custom proof summary");

    // Re-completing already completed task returns it immediately
    const resAlready = completeTask({ taskId: "task-comp-1", customPath: queuePath });
    expect(resAlready.completedTask.status).toBe("COMPLETED");

    // String overload with path in receiptsArgOrPath
    enqueueTask(
      {
        id: "task-comp-str",
        title: "Task Str",
        priority: "HIGH",
        write_scope: ["src/s.ts"],
        gate: "bun test",
      },
      queuePath,
    );
    const leaseStr = claimTaskLease({
      taskId: "task-comp-str",
      agentId: "agent-str",
      customPath: queuePath,
    });
    const resStr = completeTask("task-comp-str", leaseStr.leaseToken, queuePath);
    expect(resStr.completedTask.status).toBe("COMPLETED");

    // String overload with receipts object
    enqueueTask(
      {
        id: "task-comp-str-rec",
        title: "Task Str Rec",
        priority: "HIGH",
        write_scope: ["src/s2.ts"],
        gate: "bun test",
      },
      queuePath,
    );
    const leaseStrRec = claimTaskLease({
      taskId: "task-comp-str-rec",
      agentId: "agent-str-rec",
      customPath: queuePath,
    });
    const resStrRec = completeTask(
      "task-comp-str-rec",
      { proof_summary: "Done" },
      undefined,
      queuePath,
    );
    expect(resStrRec.completedTask.status).toBe("COMPLETED");

    // Mismatched token throws
    enqueueTask(
      {
        id: "task-comp-2",
        title: "Task 2",
        priority: "MEDIUM",
        write_scope: ["src/b.ts"],
        gate: "bun test",
      },
      queuePath,
    );
    const lease2 = claimTaskLease({
      taskId: "task-comp-2",
      agentId: "agent-2",
      customPath: queuePath,
    });
    expect(() =>
      completeTask({ taskId: "task-comp-2", leaseToken: "wrong-token", customPath: queuePath }),
    ).toThrow(HarnessError);

    // Complete with autoPrune=true
    const pruneRes = completeTask({
      taskId: "task-comp-2",
      leaseToken: lease2.leaseToken,
      autoPrune: true,
      autoArchive: true,
      customPath: queuePath,
      completedTasksPath: completedPath,
    });
    expect(pruneRes.completedTask.id).toBe("task-comp-2");
    const remaining = readTaskQueue(queuePath);
    expect(remaining.some((t) => t.id === "task-comp-2")).toBe(false);

    // Missing task throws
    expect(() => completeTask({ taskId: "non-existent", customPath: queuePath })).toThrow(
      HarnessError,
    );

    teardown();
  });

  it("covers validateCompletionReceipts edge cases", () => {
    expect(() => validateCompletionReceipts(undefined)).not.toThrow();
    expect(() => validateCompletionReceipts({})).not.toThrow();
    expect(() =>
      validateCompletionReceipts({ exit_code: 0, cognitive_verdict: "PASS" }),
    ).not.toThrow();
    expect(() =>
      validateCompletionReceipts({
        exit_code: 1,
      }),
    ).toThrow(HarnessError);
    expect(() =>
      validateCompletionReceipts({
        cognitive_verdict: "FAIL",
      }),
    ).toThrow(HarnessError);
  });
});
