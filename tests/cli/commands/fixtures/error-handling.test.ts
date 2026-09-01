import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  resolveTraceContext,
  injectTraceEnvironment,
  extractSpanHierarchy,
  formatTraceHeaders,
  type TraceContext,
} from "../../../../olt/scripts/src/telemetry/trace-context.ts";
import type {
  CliErrorEnvelope,
  CliSuccessEnvelope,
} from "../../../../olt/scripts/src/cli/registry/types.ts";
import { executeTaskAdd } from "../../../../olt/scripts/src/cli/commands/task-add.ts";
import { executeTaskList } from "../../../../olt/scripts/src/cli/commands/task-list.ts";
import { scratchRoot } from "../../../shared/fixtures/scratch-root.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/harness-error.ts";
import {
  formatCliError,
  mapErrorToExitCode,
  propagateCliExitCode,
} from "../../../../olt/scripts/src/cli/signals/error-propagation.ts";

afterAll(() => {
  process.exitCode = 0;
});

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

  test("resolves trace context from explicit flags and env vars", () => {
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

    process.env.OLT_TRACE_ID = "env-trace-123";
    process.env.OLT_SPAN_ID = "env-span-456";
    process.env.OLT_PARENT_SPAN_ID = "env-parent-789";
    process.env.OLT_SAMPLED = "1";
    const envCtx = resolveTraceContext();
    expect(envCtx.traceId).toBe("env-trace-123");
    expect(envCtx.spanId).toBe("env-span-456");
    expect(envCtx.parentSpanId).toBe("env-parent-789");
    expect(envCtx.sampled).toBe(true);
  });

  test("resolves trace context from W3C TRACEPARENT and generates random IDs when missing", () => {
    process.env.TRACEPARENT = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    const context = resolveTraceContext();
    expect(context.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(context.spanId).toBe("00f067aa0ba902b7");
    expect(context.sampled).toBe(true);

    delete process.env.TRACEPARENT;
    const randomCtx = resolveTraceContext();
    expect(randomCtx.traceId.length).toBe(32);
    expect(randomCtx.spanId.length).toBe(16);
    expect(randomCtx.parentSpanId).toBeUndefined();
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

  test("extracts span hierarchy accurately and formats HTTP headers", () => {
    const rootContext: TraceContext = { traceId: "trace-root", spanId: "span-root" };
    const rootHierarchy = extractSpanHierarchy(rootContext);
    expect(rootHierarchy.depth).toBe(0);

    const childContext: TraceContext = {
      traceId: "trace-root",
      spanId: "span-child",
      parentSpanId: "span-root",
    };
    const childHierarchy = extractSpanHierarchy(childContext);
    expect(childHierarchy.depth).toBe(1);

    const headers = formatTraceHeaders({
      traceId: "trace-111",
      spanId: "span-222",
      parentSpanId: "parent-333",
      sampled: false,
    });
    expect(headers.traceparent).toBe("00-trace-111-span-222-00");
    expect(headers["x-trace-id"]).toBe("trace-111");
  });

  test("constructs valid CLI success and error envelopes", () => {
    const success: CliSuccessEnvelope<{ task: string }> = { ok: true, data: { task: "task-1" } };
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
  });

  test("returns standard exit codes for valid and invalid command executions", async () => {
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

    const exitInvalid = await executeTaskAdd([
      "task:add",
      "--invalid-flag-option-unknown",
      "val",
      "--queue-path",
      queuePath,
    ]);
    expect(exitInvalid).toBe(2);
  });
});

describe("error-propagation", () => {
  describe("mapErrorToExitCode", () => {
    test("maps HarnessError to its declared exitCode", () => {
      const err = new HarnessError("INVALID_ARGUMENT", "Invalid argument passed", [], 2);
      expect(mapErrorToExitCode(err)).toBe(2);

      const lockErr = new HarnessError("LOCK_TIMEOUT", "Lock timeout", [], 4);
      expect(mapErrorToExitCode(lockErr)).toBe(4);
    });

    test("maps object with numeric exitCode property and known error codes", () => {
      expect(mapErrorToExitCode({ exitCode: 5 })).toBe(5);
      expect(mapErrorToExitCode({ code: "INVALID_ARGUMENT" })).toBe(2);
      expect(mapErrorToExitCode({ code: "PATH_SAFETY" })).toBe(3);
      expect(mapErrorToExitCode({ code: "LOCK_TIMEOUT" })).toBe(4);
      expect(mapErrorToExitCode({ code: "NOT_IMPLEMENTED" })).toBe(70);
    });

    test("falls back to exit code 70 for unclassified errors", () => {
      expect(mapErrorToExitCode(null)).toBe(70);
      expect(mapErrorToExitCode(undefined)).toBe(70);
      expect(mapErrorToExitCode("raw error string")).toBe(70);
      expect(mapErrorToExitCode({})).toBe(70);
      expect(mapErrorToExitCode(new Error("standard error without code"))).toBe(70);
    });
  });

  describe("formatCliError", () => {
    test("formats json output for errors", () => {
      const err = new HarnessError("INVALID_ARGUMENT", "Bad value");
      const jsonOut = formatCliError(err, { json: true });
      const parsed = JSON.parse(jsonOut) as {
        ok: boolean;
        error: { code: string; message: string };
      };
      expect(parsed.ok).toBe(false);
      expect(parsed.error.code).toBe("INVALID_ARGUMENT");
    });

    test("formats HarnessError with and without fix", () => {
      const errWithFix = new HarnessError("INVALID_ARGUMENT", "Missing flag", [], 2, "Pass --flag");
      const formattedFix = formatCliError(errWithFix);
      expect(formattedFix).toContain("**Error (INVALID_ARGUMENT)**: Missing flag");
      expect(formattedFix).toContain("> **Fix**: Pass --flag");

      const errNoFix = new HarnessError("INVALID_STATE", "Cannot proceed");
      const formattedNoFix = formatCliError(errNoFix);
      expect(formattedNoFix).toContain("**Error (INVALID_STATE)**: Cannot proceed");
      expect(formattedNoFix).not.toContain("**Fix**");
    });

    test("formats standard Error and non-Error objects", () => {
      const stdErr = new Error("Generic failure");
      expect(formatCliError(stdErr)).toBe("**Fatal Internal Error**: Generic failure\n");
      expect(formatCliError("string failure")).toBe("**Fatal Internal Error**: string failure\n");
      expect(formatCliError(404)).toBe("**Fatal Internal Error**: 404\n");
    });
  });

  describe("propagateCliExitCode", () => {
    test("assigns process.exitCode and returns mapped exit code", () => {
      const originalExitCode = process.exitCode;
      try {
        const err = new HarnessError("PATH_SAFETY", "Unsafe path", [], 3);
        const code = propagateCliExitCode(err);
        expect(code).toBe(3);
        expect(process.exitCode).toBe(3);
      } finally {
        process.exitCode = originalExitCode;
      }
    });
  });
});
