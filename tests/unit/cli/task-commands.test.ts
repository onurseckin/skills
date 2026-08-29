import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  executeTaskAdd,
  executeTaskComplete,
  executeTaskLease,
  executeTaskList,
  taskAddCommand,
  taskCompleteCommand,
  taskLeaseCommand,
  taskListCommand,
} from "../../../olt/scripts/src/cli/commands/task-queue-ops.ts";
import {
  injectTraceEnvironment,
  resolveTraceContext,
  type TraceContext,
} from "../../../olt/scripts/src/telemetry/trace-context.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("Telemetry Trace Context (task-cli-03)", () => {
  test("resolves trace context from explicit command flags", () => {
    const context = resolveTraceContext({
      "trace-id": "4bf92f3577b34da6a3ce929d0e0e4736",
      "span-id": "00f067aa0ba902b7",
      "parent-span-id": "5fb397be34d23b0f",
      "trace-sampled": true,
    });
    expect(context.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(context.spanId).toBe("00f067aa0ba902b7");
    expect(context.parentSpanId).toBe("5fb397be34d23b0f");
    expect(context.sampled).toBe(true);
  });

  test("resolves trace context from environment variables", () => {
    const originalEnv = { ...process.env };
    try {
      process.env.OLT_TRACE_ID = "11112222333344445555666677778888";
      process.env.OLT_SPAN_ID = "aaaabbbbccccdddd";
      process.env.OLT_PARENT_SPAN_ID = "9999888877776666";
      process.env.OLT_SAMPLED = "1";
      const context = resolveTraceContext({});
      expect(context.traceId).toBe("11112222333344445555666677778888");
      expect(context.spanId).toBe("aaaabbbbccccdddd");
      expect(context.parentSpanId).toBe("9999888877776666");
      expect(context.sampled).toBe(true);
    } finally {
      process.env = originalEnv;
    }
  });

  test("extracts trace context from W3C TRACEPARENT environment variable", () => {
    const originalEnv = { ...process.env };
    try {
      delete process.env.OLT_TRACE_ID;
      delete process.env.TRACE_ID;
      delete process.env.OLT_SPAN_ID;
      delete process.env.SPAN_ID;
      process.env.TRACEPARENT = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
      const context = resolveTraceContext({});
      expect(context.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
      expect(context.spanId).toBe("00f067aa0ba902b7");
      expect(context.sampled).toBe(true);
    } finally {
      process.env = originalEnv;
    }
  });

  test("generates random cryptographically valid trace and span IDs when omitted", () => {
    const context = resolveTraceContext({});
    expect(typeof context.traceId).toBe("string");
    expect(context.traceId.length).toBe(32);
    expect(/^[0-9a-f]{32}$/.test(context.traceId)).toBe(true);
    expect(typeof context.spanId).toBe("string");
    expect(context.spanId.length).toBe(16);
    expect(/^[0-9a-f]{16}$/.test(context.spanId)).toBe(true);
  });

  test("injectTraceEnvironment injects standard and W3C trace headers into target environment", () => {
    const targetEnv: Record<string, string> = {};
    const context: TraceContext = {
      traceId: "abcdef0123456789abcdef0123456789",
      spanId: "1234567890abcdef",
      parentSpanId: "fedcba0987654321",
      sampled: true,
    };
    injectTraceEnvironment(targetEnv, context);
    expect(targetEnv.OLT_TRACE_ID).toBe("abcdef0123456789abcdef0123456789");
    expect(targetEnv.OLT_SPAN_ID).toBe("1234567890abcdef");
    expect(targetEnv.OLT_PARENT_SPAN_ID).toBe("fedcba0987654321");
    expect(targetEnv.OLT_SAMPLED).toBe("1");
    expect(targetEnv.TRACEPARENT).toBe(
      "00-abcdef0123456789abcdef0123456789-1234567890abcdef-01",
    );
  });
});

describe("Task CLI Enqueue and List Operations (task-cli-04)", () => {
  test("executeTaskAdd enqueues task and returns exit code 0", async () => {
    const dir = scratchRoot(import.meta.path, "cli-task-add-success");
    const queuePath = join(dir, "task-queue.json");
    const exitCode = await executeTaskAdd([
      "task:add",
      "--task",
      "task-auth-01",
      "--title",
      "Implement auth tokens",
      "--description",
      "Full token verification workflow",
      "--priority",
      "HIGH",
      "--gate",
      "bun test tests/unit/auth.test.ts",
      "--write-scope",
      "src/auth/tokens.ts",
      "--queue-path",
      queuePath,
    ]);
    expect(exitCode).toBe(0);
    const listResult = taskListCommand({ "queue-path": queuePath });
    const tasks = listResult.tasks as Array<Record<string, unknown>>;
    expect(tasks.length).toBe(1);
    expect(tasks[0]?.id).toBe("task-auth-01");
    expect(tasks[0]?.title).toBe("Implement auth tokens");
    expect(tasks[0]?.priority).toBe("HIGH");
  });

  test("executeTaskAdd returns exit code 2 on invalid flag argument", async () => {
    const dir = scratchRoot(import.meta.path, "cli-task-add-invalid");
    const queuePath = join(dir, "task-queue.json");
    const exitCode = await executeTaskAdd([
      "task:add",
      "--invalid-flag-option",
      "foo",
      "--queue-path",
      queuePath,
    ]);
    expect(exitCode).toBe(2);
  });

  test("executeTaskList queries tasks with Cowan pagination and returns exit code 0", async () => {
    const dir = scratchRoot(import.meta.path, "cli-task-list-cowan");
    const queuePath = join(dir, "task-queue.json");
    for (let i = 1; i <= 5; i += 1) {
      taskAddCommand({
        task: `task-item-0${i}`,
        title: `Task item ${i}`,
        description: `Description ${i}`,
        priority: i % 2 === 0 ? "HIGH" : "MEDIUM",
        gate: "bun test",
        "queue-path": queuePath,
      });
    }
    const exitCodeDefault = await executeTaskList(["task:list", "--queue-path", queuePath]);
    expect(exitCodeDefault).toBe(0);
    const paginatedRes = taskListCommand({ "queue-path": queuePath, limit: 2, page: 2 });
    expect(paginatedRes.total).toBe(5);
    expect(paginatedRes.count).toBe(2);
    expect(paginatedRes.offset).toBe(2);
    expect(paginatedRes.limit).toBe(2);
    const tasks = paginatedRes.tasks as Array<Record<string, unknown>>;
    expect(tasks.length).toBe(2);
  });

  test("executeTaskList filters tasks by priority and search keyword", async () => {
    const dir = scratchRoot(import.meta.path, "cli-task-list-filters");
    const queuePath = join(dir, "task-queue.json");
    taskAddCommand({
      task: "task-parser",
      title: "Parser module",
      description: "AST parse engine",
      priority: "CRITICAL",
      gate: "bun test",
      "queue-path": queuePath,
    });
    taskAddCommand({
      task: "task-docs",
      title: "Documentation module",
      description: "Update markdown docs",
      priority: "LOW",
      gate: "bun test",
      "queue-path": queuePath,
    });
    const filterResult = taskListCommand({ "queue-path": queuePath, priority: "CRITICAL" });
    const criticalTasks = filterResult.tasks as Array<Record<string, unknown>>;
    expect(criticalTasks.length).toBe(1);
    expect(criticalTasks[0]?.id).toBe("task-parser");
    const searchResult = taskListCommand({ "queue-path": queuePath, search: "docs" });
    const searchTasks = searchResult.tasks as Array<Record<string, unknown>>;
    expect(searchTasks.length).toBe(1);
    expect(searchTasks[0]?.id).toBe("task-docs");
  });

  test("executeTaskList returns exit code 2 on invalid flag argument", async () => {
    const dir = scratchRoot(import.meta.path, "cli-task-list-invalid");
    const queuePath = join(dir, "task-queue.json");
    const exitCode = await executeTaskList([
      "task:list",
      "--bogus-argument",
      "xyz",
      "--queue-path",
      queuePath,
    ]);
    expect(exitCode).toBe(2);
  });
});

describe("Task CLI Lease and Complete Operations (task-cli-05)", () => {
  test("executeTaskLease acquires lease token and executeTaskComplete finalizes task", async () => {
    const dir = scratchRoot(import.meta.path, "cli-task-lease-complete");
    const queuePath = join(dir, "task-queue.json");
    const archivePath = join(dir, "completed.jsonl");

    taskAddCommand({
      task: "task-pipe-1",
      title: "Pipeline task 1",
      gate: "bun test",
      "queue-path": queuePath,
    });
    taskAddCommand({
      task: "task-pipe-2",
      title: "Pipeline task 2",
      dependencies: ["task-pipe-1"],
      gate: "bun test",
      "queue-path": queuePath,
    });

    const leaseRes = taskLeaseCommand({
      task: "task-pipe-1",
      "agent-id": "worker-agent",
      "lease-duration": 1800,
      "queue-path": queuePath,
    });
    const token = String(leaseRes.token ?? leaseRes.leaseToken);
    expect(typeof token).toBe("string");
    expect(token.startsWith("lease-")).toBe(true);

    const completeExit = await executeTaskComplete([
      "task:complete",
      "--task",
      "task-pipe-1",
      "--agent-id",
      "worker-agent",
      "--token",
      token,
      "--proof-summary",
      "All unit tests pass",
      "--auto-archive",
      "--archive-path",
      archivePath,
      "--queue-path",
      queuePath,
    ]);
    expect(completeExit).toBe(0);

    const listRes = taskListCommand({ "queue-path": queuePath });
    const tasks = listRes.tasks as Array<Record<string, unknown>>;
    const task1 = tasks.find((t) => t.id === "task-pipe-1");
    const task2 = tasks.find((t) => t.id === "task-pipe-2");
    expect(task1?.status).toBe("COMPLETED");
    expect(task2?.status).toBe("PENDING");
    expect(task2?.blocked_by).toEqual([]);
  });

  test("executeTaskLease CLI verb executes successfully", async () => {
    const dir = scratchRoot(import.meta.path, "cli-task-lease-exec");
    const queuePath = join(dir, "task-queue.json");

    taskAddCommand({
      task: "task-lease-test",
      title: "Lease test task",
      gate: "bun test",
      "queue-path": queuePath,
    });

    const exitCode = await executeTaskLease([
      "task:lease",
      "--task",
      "task-lease-test",
      "--agent-id",
      "agent-1",
      "--queue-path",
      queuePath,
    ]);
    expect(exitCode).toBe(0);
  });

  test("executeTaskLease returns exit code 2 on invalid flag", async () => {
    const dir = scratchRoot(import.meta.path, "cli-task-lease-invalid");
    const queuePath = join(dir, "task-queue.json");
    const exitCode = await executeTaskLease([
      "task:lease",
      "--bad-option",
      "val",
      "--queue-path",
      queuePath,
    ]);
    expect(exitCode).toBe(2);
  });

  test("executeTaskComplete returns exit code 2 on invalid flag", async () => {
    const dir = scratchRoot(import.meta.path, "cli-task-complete-invalid");
    const queuePath = join(dir, "task-queue.json");
    const exitCode = await executeTaskComplete([
      "task:complete",
      "--unknown-flag",
      "val",
      "--queue-path",
      queuePath,
    ]);
    expect(exitCode).toBe(2);
  });
});
