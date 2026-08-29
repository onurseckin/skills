export interface TraceContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly sampled?: boolean;
}

export interface SpanHierarchy {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly depth: number;
}

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function extractStringFlag(flags: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
  if (!flags) return undefined;
  for (const k of keys) {
    if (typeof flags[k] === "string") return flags[k] as string;
  }
  return undefined;
}

export function resolveTraceContext(flags?: Record<string, unknown>): TraceContext {
  const flagTrace = extractStringFlag(flags, "trace-id", "traceId", "trace_id");
  const flagSpan = extractStringFlag(flags, "span-id", "spanId", "span_id");
  const flagParent = extractStringFlag(flags, "parent-span-id", "parentSpanId", "parent_span_id");
  const flagSampled =
    typeof flags?.["trace-sampled"] === "boolean"
      ? (flags["trace-sampled"] as boolean)
      : typeof flags?.sampled === "boolean"
        ? (flags.sampled as boolean)
        : undefined;

  let envTrace = process.env.OLT_TRACE_ID ?? process.env.TRACE_ID;
  let envSpan = process.env.OLT_SPAN_ID ?? process.env.SPAN_ID;
  const envParent = process.env.OLT_PARENT_SPAN_ID ?? process.env.PARENT_SPAN_ID;
  let envSampled = process.env.OLT_SAMPLED === "1" || process.env.OLT_SAMPLED === "true";

  const traceparent = process.env.TRACEPARENT;
  if (traceparent && !envTrace) {
    const parts = traceparent.split("-");
    if (parts.length === 4 && parts[0] === "00") {
      envTrace = parts[1];
      if (!envSpan) envSpan = parts[2];
      if (parts[3] === "01") envSampled = true;
    }
  }

  const traceId = flagTrace ?? envTrace ?? randomHex(16);
  const spanId = flagSpan ?? envSpan ?? randomHex(8);
  const parentSpanId = flagParent ?? envParent ?? undefined;
  const sampled = flagSampled ?? (envSampled ? true : undefined);

  return {
    traceId,
    spanId,
    ...(parentSpanId !== undefined ? { parentSpanId } : {}),
    ...(sampled !== undefined ? { sampled } : {}),
  };
}

export function injectTraceEnvironment(
  env: Record<string, string>,
  context: TraceContext,
): void {
  env.OLT_TRACE_ID = context.traceId;
  env.OLT_SPAN_ID = context.spanId;
  if (context.parentSpanId) env.OLT_PARENT_SPAN_ID = context.parentSpanId;
  if (context.sampled !== undefined) env.OLT_SAMPLED = context.sampled ? "1" : "0";
  const sampleFlag = context.sampled ? "01" : "00";
  env.TRACEPARENT = `00-${context.traceId}-${context.spanId}-${sampleFlag}`;
}

export function extractSpanHierarchy(context: TraceContext): SpanHierarchy {
  return {
    traceId: context.traceId,
    spanId: context.spanId,
    parentSpanId: context.parentSpanId,
    depth: context.parentSpanId !== undefined ? 1 : 0,
  };
}

export function formatTraceHeaders(context: TraceContext): Record<string, string> {
  const sampleFlag = context.sampled ? "01" : "00";
  const headers: Record<string, string> = {
    traceparent: `00-${context.traceId}-${context.spanId}-${sampleFlag}`,
    "x-trace-id": context.traceId,
    "x-span-id": context.spanId,
  };
  if (context.parentSpanId) headers["x-parent-span-id"] = context.parentSpanId;
  return headers;
}
