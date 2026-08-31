import { describe, expect, it } from "bun:test";
import {
  formatTraceHeaders,
  injectTraceEnvironment,
  extractSpanHierarchy,
  resolveTraceContext,
} from "../../../olt/scripts/src/telemetry/trace-context.ts";
import {
  allowlistProject,
  allowlistRecord,
  deepRedact,
  isAllowedRawField,
  isSensitiveKey,
  redactRecord,
  redactSecretsInString,
} from "../../../olt/scripts/src/telemetry/redact.ts";
import {
  AntigravityCollector,
  ClaudeCollector,
  CodexCollector,
  CursorCollector,
  DefaultCollectorEnvironment,
  OpenAICollector,
  createDefaultCollectors,
  TelemetryNormalizationEngine,
  formatPreciseProgressBar,
  formatResetTime,
  formatTierBadge,
  formatTierShort,
  renderProgressBar,
  AUTO_WAKE_PROMPT,
  CRITICAL_WRAP_UP_MESSAGE,
  type CircuitBreakerStatus,
  DEFAULT_AUTO_WAKE_BUFFER_SECONDS,
  DEFAULT_QUOTA_THRESHOLD,
  DEFAULT_SAFE_WINDOW_SECONDS,
  QuotaCircuitBreaker,
  UNMEASURED_QUOTA_WRAP_UP_MESSAGE,
  extractResetTime,
  formatCircuitBreakerMarkdown,
  DEFAULT_QUOTA_SNAPSHOT_FILENAME,
  STANDARD_SUPERVISORY_CRONS,
  captureDagSnapshot,
  formatDagResumeMarkdown,
  formatDagSnapshotMarkdown,
  loadDagSnapshot,
  persistDagSnapshot,
  resumeDagSnapshot,
} from "../../../olt/scripts/src/telemetry/index.ts";

describe("Telemetry Trace Context and Comprehensive Coverage", () => {
  it("covers resolveTraceContext with flags, environment, traceparent, and defaults", () => {
    const origEnv = { ...process.env };

    // 1. From flags
    const fromFlags = resolveTraceContext({
      "trace-id": "trace-123",
      "span-id": "span-456",
      "parent-span-id": "parent-789",
      "trace-sampled": true,
    });
    expect(fromFlags.traceId).toBe("trace-123");
    expect(fromFlags.spanId).toBe("span-456");
    expect(fromFlags.parentSpanId).toBe("parent-789");
    expect(fromFlags.sampled).toBe(true);

    // 2. From camelCase and snake_case flags
    const fromAltFlags = resolveTraceContext({
      traceId: "trace-alt",
      spanId: "span-alt",
      parentSpanId: "parent-alt",
      sampled: false,
    });
    expect(fromAltFlags.traceId).toBe("trace-alt");
    expect(fromAltFlags.sampled).toBe(false);

    const fromSnakeFlags = resolveTraceContext({
      trace_id: "trace-snake",
      span_id: "span-snake",
      parent_span_id: "parent-snake",
    });
    expect(fromSnakeFlags.traceId).toBe("trace-snake");
    expect(fromSnakeFlags.spanId).toBe("span-snake");
    expect(fromSnakeFlags.parentSpanId).toBe("parent-snake");

    // 3. From environment variables
    process.env.OLT_TRACE_ID = "env-olt-trace";
    process.env.OLT_SPAN_ID = "env-olt-span";
    process.env.OLT_PARENT_SPAN_ID = "env-olt-parent";
    process.env.OLT_SAMPLED = "1";
    const fromEnv = resolveTraceContext();
    expect(fromEnv.traceId).toBe("env-olt-trace");
    expect(fromEnv.spanId).toBe("env-olt-span");
    expect(fromEnv.parentSpanId).toBe("env-olt-parent");
    expect(fromEnv.sampled).toBe(true);

    delete process.env.OLT_TRACE_ID;
    delete process.env.OLT_SPAN_ID;
    delete process.env.OLT_PARENT_SPAN_ID;
    delete process.env.OLT_SAMPLED;

    // 4. From TRACEPARENT
    process.env.TRACEPARENT = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    const fromTraceparent = resolveTraceContext();
    expect(fromTraceparent.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(fromTraceparent.spanId).toBe("00f067aa0ba902b7");
    expect(fromTraceparent.sampled).toBe(true);
    delete process.env.TRACEPARENT;

    // 5. Generated fallback
    const fallback = resolveTraceContext();
    expect(fallback.traceId.length).toBe(32);
    expect(fallback.spanId.length).toBe(16);

    // Restore env
    process.env = origEnv;
  });

  it("covers injectTraceEnvironment, extractSpanHierarchy, and formatTraceHeaders", () => {
    const context = {
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      parentSpanId: "5a3f2b1c",
      sampled: true,
    };

    const env: Record<string, string> = {};
    injectTraceEnvironment(env, context);
    expect(env.OLT_TRACE_ID).toBe(context.traceId);
    expect(env.OLT_SPAN_ID).toBe(context.spanId);
    expect(env.OLT_PARENT_SPAN_ID).toBe("5a3f2b1c");
    expect(env.OLT_SAMPLED).toBe("1");
    expect(env.TRACEPARENT).toBe(`00-${context.traceId}-${context.spanId}-01`);

    const hierarchy = extractSpanHierarchy(context);
    expect(hierarchy.depth).toBe(1);
    expect(hierarchy.parentSpanId).toBe("5a3f2b1c");

    const rootHierarchy = extractSpanHierarchy({ traceId: "t1", spanId: "s1" });
    expect(rootHierarchy.depth).toBe(0);
    expect(rootHierarchy.parentSpanId).toBeUndefined();

    const headers = formatTraceHeaders(context);
    expect(headers["traceparent"]).toBe(`00-${context.traceId}-${context.spanId}-01`);
    expect(headers["x-trace-id"]).toBe(context.traceId);
    expect(headers["x-parent-span-id"]).toBe("5a3f2b1c");
  });

  it("covers redact.ts and allowlist functions", () => {
    expect(isSensitiveKey("rawconfig")).toBe(true);
    expect(isSensitiveKey("api_key")).toBe(true);
    expect(isSensitiveKey("safe_name")).toBe(false);

    expect(isAllowedRawField("plan")).toBe(true);
    expect(isAllowedRawField("fivehour")).toBe(true);
    expect(isAllowedRawField("unknown_field")).toBe(false);

    const secretStr = "Bearer secrettoken12345 sk-1234567890abcdef sess-1234567890abcdef";
    const redacted = redactSecretsInString(secretStr);
    expect(redacted).not.toContain("secrettoken12345");
    expect(redacted).toContain("[REDACTED]");

    const deeplyNested: Record<string, unknown> = {
      level0: {
        apiKey: "sk-secret12345678",
        items: [{ password: "secret" }, 42, "text with Bearer 123456789012"],
      },
    };
    const redactedRecord = redactRecord(deeplyNested);
    expect(redactedRecord).toBeDefined();

    const projected = allowlistRecord({
      plan: "pro",
      fivehour: 50,
      disallowed: "drop-me",
    });
    expect(projected.plan).toBe("pro");
    expect(projected.disallowed).toBeUndefined();

    // Depth overflow
    let deep: unknown = {};
    let cur = deep as Record<string, unknown>;
    for (let i = 0; i < 20; i++) {
      cur.nested = {};
      cur = cur.nested as Record<string, unknown>;
    }
    expect(deepRedact(deep)).toBeDefined();
    expect(allowlistProject(deep)).toBeDefined();
  });

  it("verifies telemetry/index.ts exports and constants", () => {
    expect(AUTO_WAKE_PROMPT).toBeDefined();
    expect(CRITICAL_WRAP_UP_MESSAGE).toBeDefined();
    expect(UNMEASURED_QUOTA_WRAP_UP_MESSAGE).toBeDefined();
    expect(DEFAULT_AUTO_WAKE_BUFFER_SECONDS).toBe(60);
    expect(DEFAULT_QUOTA_THRESHOLD).toBe(10.0);
    expect(DEFAULT_SAFE_WINDOW_SECONDS).toBe(18000);
    expect(DEFAULT_QUOTA_SNAPSHOT_FILENAME).toBe("quota-dag-snapshot.json");
    expect(STANDARD_SUPERVISORY_CRONS).toBeDefined();

    const collectors = createDefaultCollectors();
    expect(collectors.length).toBeGreaterThan(0);
    const cb = new QuotaCircuitBreaker();
    expect(cb).toBeDefined();
  });
});
