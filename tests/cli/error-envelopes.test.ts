import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import {
  resolveTraceContext,
  injectTraceEnvironment,
  extractSpanHierarchy,
  formatTraceHeaders,
  type TraceContext,
} from "../../olt/scripts/src/telemetry/trace-context.ts";
import type {
  CliErrorEnvelope,
  CliSuccessEnvelope,
} from "../../olt/scripts/src/cli/registry/types.ts";
import { executeTaskAdd } from "../../olt/scripts/src/cli/commands/task-add.ts";
import { executeTaskList } from "../../olt/scripts/src/cli/commands/task-list.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("Distributed Trace Context & Error Envelopes", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.OLT_TRACE_ID;
    delete process.env.OLT_SPAN_ID;
    delete process.env.OLT_PARENT_SPAN_ID;
    delete process.env.OLT_SAMPLED;
    delete process.env.TRACEPARENT;
    delete process.env.TRACE_ID;
    delete process.env.SPAN_ID;
    delete process.env.PARENT_SPAN_ID;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("resolves trace context from explicit flags", () => {
    const context = resolveTraceContext({
      "trace-id": "custom-trace-001",
      "span-id": "custom-span-002",
      "parent-span-id": "custom-parent-003",
      "trace-sampled": true,
    });

    expect(context.traceId).toBe("custom-trace-001");
    expect(context.spanId).toBe("custom-span-002");
    expect(context.parentSpanId).toBe("custom-parent-003");
    expect(context.sampled).toBe(true);
  });

  test("resolves trace context from environment variables", () => {
    process.env.OLT_TRACE_ID = "env-trace-123";
    process.env.OLT_SPAN_ID = "env-span-456";
    process.env.OLT_PARENT_SPAN_ID = "env-parent-789";
    process.env.OLT_SAMPLED = "1";

    const context = resolveTraceContext();

    expect(context.traceId).toBe("env-trace-123");
    expect(context.spanId).toBe("env-span-456");
    expect(context.parentSpanId).toBe("env-parent-789");
    expect(context.sampled).toBe(true);
  });

  test("resolves trace context from W3C TRACEPARENT environment variable", () => {
    process.env.TRACEPARENT = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

    const context = resolveTraceContext();

    expect(context.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(context.spanId).toBe("00f067aa0ba902b7");
    expect(context.sampled).toBe(true);
  });

  test("generates random IDs when context is missing", () => {
    const context = resolveTraceContext();

    expect(context.traceId.length).toBe(32);
    expect(context.spanId.length).toBe(16);
    expect(context.parentSpanId).toBeUndefined();
  });

  test("injects trace context into environment record", () => {
    const env: Record<string, string> = {};
    const context: TraceContext = {
      traceId: "trace-abc",
      spanId: "span-def",
      parentSpanId: "parent-ghi",
      sampled: true,
    };

    injectTraceEnvironment(env, context);

    expect(env.OLT_TRACE_ID).toBe("trace-abc");
    expect(env.OLT_SPAN_ID).toBe("span-def");
    expect(env.OLT_PARENT_SPAN_ID).toBe("parent-ghi");
    expect(env.OLT_SAMPLED).toBe("1");
    expect(env.TRACEPARENT).toBe("00-trace-abc-span-def-01");
  });

  test("extracts span hierarchy accurately", () => {
    const rootContext: TraceContext = {
      traceId: "trace-root",
      spanId: "span-root",
    };
    const rootHierarchy = extractSpanHierarchy(rootContext);
    expect(rootHierarchy.traceId).toBe("trace-root");
    expect(rootHierarchy.spanId).toBe("span-root");
    expect(rootHierarchy.parentSpanId).toBeUndefined();
    expect(rootHierarchy.depth).toBe(0);

    const childContext: TraceContext = {
      traceId: "trace-root",
      spanId: "span-child",
      parentSpanId: "span-root",
    };
    const childHierarchy = extractSpanHierarchy(childContext);
    expect(childHierarchy.traceId).toBe("trace-root");
    expect(childHierarchy.spanId).toBe("span-child");
    expect(childHierarchy.parentSpanId).toBe("span-root");
    expect(childHierarchy.depth).toBe(1);
  });

  test("formats HTTP trace headers conforming to W3C and vendor spec", () => {
    const context: TraceContext = {
      traceId: "trace-111",
      spanId: "span-222",
      parentSpanId: "parent-333",
      sampled: false,
    };

    const headers = formatTraceHeaders(context);

    expect(headers.traceparent).toBe("00-trace-111-span-222-00");
    expect(headers["x-trace-id"]).toBe("trace-111");
    expect(headers["x-span-id"]).toBe("span-222");
    expect(headers["x-parent-span-id"]).toBe("parent-333");
  });

  test("constructs valid CLI success and error envelopes", () => {
    const success: CliSuccessEnvelope<{ task: string }> = {
      ok: true,
      data: { task: "task-1" },
    };
    expect(success.ok).toBe(true);
    expect(success.data.task).toBe("task-1");

    const error: CliErrorEnvelope = {
      ok: false,
      error: {
        code: "INVALID_ARGUMENT",
        message: "Missing required argument --run",
        severity: "error",
        exitCode: 2,
        fix: "Provide --run <run-id>",
      },
    };
    expect(error.ok).toBe(false);
    expect(error.error.code).toBe("INVALID_ARGUMENT");
    expect(error.error.exitCode).toBe(2);
    expect(error.error.severity).toBe("error");
  });

  test("returns standard exit code 0 for valid command executions", async () => {
    const dir = scratchRoot(import.meta.path, "envelope-valid-exec");
    const queuePath = join(dir, "task-queue.json");

    const exitAdd = await executeTaskAdd([
      "task:add",
      "--task",
      `env-test-task-${Date.now()}`,
      "--title",
      "Valid task",
      "--queue-path",
      queuePath,
    ]);
    expect(exitAdd).toBe(0);

    const exitList = await executeTaskList(["task:list", "--queue-path", queuePath]);
    expect(exitList).toBe(0);
  });

  test("returns standard exit code 2 for invalid arguments / unknown flags", async () => {
    const dir = scratchRoot(import.meta.path, "envelope-invalid-flags");
    const queuePath = join(dir, "task-queue.json");

    const exitAdd = await executeTaskAdd([
      "task:add",
      "--invalid-flag-option-unknown",
      "val",
      "--queue-path",
      queuePath,
    ]);
    expect(exitAdd).toBe(2);

    const exitList = await executeTaskList([
      "task:list",
      "--unknown-filter-flag",
      "val",
      "--queue-path",
      queuePath,
    ]);
    expect(exitList).toBe(2);
  });
});
