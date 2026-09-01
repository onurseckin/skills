import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  assertValidActiveLease,
  assertWriteScopeASTPurity,
  claimTaskLease,
  completeTask,
  enqueueTask,
  enqueueTasksBatch,
  failTask,
  readTaskQueue,
  stageWorktreeProgress,
  translateSuspendedLeases,
  validateCompletionReceipts,
  type TaskQueueItem,
} from "../../../olt/scripts/src/task/queue/index.ts";
import { scratchRoot } from "../task-fixture.ts";

describe("Task Queue Transitions Engine", () => {
  const testDir = scratchRoot(import.meta.path, "transitions-val");
  const queuePath = join(testDir, "TASK_QUEUE.jsonl");

  beforeEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  test("failTask supports escalateOnMaxRetries", () => {
    enqueueTask(
      {
        id: "task-esc-test",
        title: "Escalate Task",
        write_scope: ["src/esc.ts"],
        gate: "bun test",
        max_retries: 0,
      },
      queuePath,
    );

    const res = failTask({
      taskId: "task-esc-test",
      errorMessage: "Critical failure",
      escalateOnMaxRetries: true,
      customPath: queuePath,
    });

    expect(res.escalated).toBe(true);
    expect(res.task.status).toBe("ESCALATED");
  });

  test("assertValidActiveLease validates lease correctly", () => {
    const validTask: TaskQueueItem = {
      id: "t1",
      title: "T1",
      description: "",
      priority: "HIGH",
      status: "IN_PROGRESS",
      write_scope: ["src/t1.ts"],
      gate: "bun test",
      charter_goals: [],
      acceptance_criteria: [],
      dependencies: [],
      blocked_by: [],
      source_type: "self_evolution",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      retry_count: 0,
      max_retries: 3,
      lease: {
        agent_id: "a1",
        token: "tok-123",
        leased_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60000).toISOString(),
        attempt: 1,
        lease_duration_seconds: 60,
      },
    };

    expect(() => assertValidActiveLease(validTask, "tok-123")).not.toThrow();
    expect(() => assertValidActiveLease(validTask, "wrong-tok")).toThrow(HarnessError);

    const expiredTask: TaskQueueItem = {
      ...validTask,
      lease: { ...validTask.lease!, expires_at: new Date(Date.now() - 1000).toISOString() },
    };
    expect(() => assertValidActiveLease(expiredTask)).toThrow(HarnessError);

    const noLeaseTask: TaskQueueItem = { ...validTask, lease: null };
    expect(() => assertValidActiveLease(noLeaseTask)).toThrow(HarnessError);
  });

  test("validateCompletionReceipts verifies mechanical and cognitive channels", () => {
    expect(() =>
      validateCompletionReceipts({ exit_code: 0, cognitive_verdict: "PASS" }),
    ).not.toThrow();
    expect(() => validateCompletionReceipts()).not.toThrow();
    expect(() => validateCompletionReceipts({ exit_code: 1 })).toThrow(HarnessError);
    expect(() => validateCompletionReceipts({ cognitive_verdict: "FAIL" })).toThrow(HarnessError);
  });

  test("assertWriteScopeASTPurity detects comments in source files", () => {
    const cleanFile = join(testDir, "clean.ts");
    const commentedFile = join(testDir, "commented.ts");
    writeFileSync(cleanFile, "export const x = 1;\n");
    writeFileSync(commentedFile, "export const y = 2;\n// comment\n");

    expect(() => assertWriteScopeASTPurity(testDir, ["clean.ts"])).not.toThrow();
    expect(() => assertWriteScopeASTPurity(testDir, ["commented.ts"])).toThrow(HarnessError);
  });

  test("stageWorktreeProgress executes git add -A", () => {
    const gitDir = join(testDir, "git-test");
    mkdirSync(gitDir, { recursive: true });
    spawnSync("git", ["init", "--quiet"], { cwd: gitDir });
    writeFileSync(join(gitDir, "file.txt"), "hello");

    expect(() => stageWorktreeProgress(gitDir)).not.toThrow();
    const status = spawnSync("git", ["status", "--porcelain"], { cwd: gitDir, encoding: "utf8" });
    expect(status.stdout).toContain("A  file.txt");
  });

  test("translateSuspendedLeases shifts lease deadlines forward", () => {
    const expires = new Date(Date.now() + 10000).toISOString();
    const task: TaskQueueItem = {
      id: "t-freeze",
      title: "Freeze",
      description: "",
      priority: "HIGH",
      status: "IN_PROGRESS",
      write_scope: ["src/freeze.ts"],
      gate: "bun test",
      charter_goals: [],
      acceptance_criteria: [],
      dependencies: [],
      blocked_by: [],
      source_type: "self_evolution",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      retry_count: 0,
      max_retries: 3,
      lease: {
        agent_id: "agent-freeze",
        token: "tok-freeze",
        leased_at: new Date().toISOString(),
        expires_at: expires,
        attempt: 1,
        lease_duration_seconds: 10,
      },
    };

    const res = translateSuspendedLeases([task], 5000);
    expect(res.translatedCount).toBe(1);
    const updatedExp = Date.parse(res.tasks[0]!.lease!.expires_at);
    expect(updatedExp).toBe(Date.parse(expires) + 5000);

    const zeroRes = translateSuspendedLeases([task], 0);
    expect(zeroRes.translatedCount).toBe(0);
  });
});
