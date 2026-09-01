import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  executeTaskAdd,
  taskListCommand,
} from "../../../../../olt/scripts/src/cli/commands/task-queue-ops.ts";
import {
  injectTraceEnvironment,
  resolveTraceContext,
  type TraceContext,
} from "../../../../../olt/scripts/src/telemetry/trace-context.ts";
import { cleanupVirtualCliFS, setupVirtualCliFS } from "../../fixtures/full-lifecycle-fixture.ts";

const roots: string[] = [];

async function createVirtualDir(prefix: string): Promise<string> {
  const dir = `/virtual/cli/${prefix}-${Math.random().toString(36).slice(2)}`;
  roots.push(dir);
  await mkdir(dir, { recursive: true });
  return dir;
}

describe("Telemetry Trace Context (task-cli-03)", () => {
  beforeEach(() => {
    setupVirtualCliFS();
  });

  afterEach(() => {
    cleanupVirtualCliFS();
    roots.length = 0;
  });

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
    expect(targetEnv.TRACEPARENT).toBe("00-abcdef0123456789abcdef0123456789-1234567890abcdef-01");
  });
});

describe("Task CLI Enqueue and List Operations (task-cli-04)", () => {
  beforeEach(() => {
    setupVirtualCliFS();
  });

  afterEach(() => {
    cleanupVirtualCliFS();
    roots.length = 0;
  });

  test("executeTaskAdd enqueues task and returns exit code 0", async () => {
    const dir = await createVirtualDir("cli-task-add-success");
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
      "bun test tests/core/auth.test.ts",
      "--write-scope",
      "src/auth/tokens.ts",
      "--queue-path",
      queuePath,
    ]);
    expect(exitCode).toBe(0);

    const listRes = taskListCommand({ "queue-path": queuePath });
    const tasks = listRes.tasks as Array<Record<string, unknown>>;
    expect(tasks.length).toBe(1);
    expect(tasks[0]?.id).toBe("task-auth-01");
    expect(tasks[0]?.title).toBe("Implement auth tokens");
    expect(tasks[0]?.priority).toBe("HIGH");
  });

  test("executeTaskAdd returns exit code 2 on invalid flag argument", async () => {
    const dir = await createVirtualDir("cli-task-add-invalid");
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
});
