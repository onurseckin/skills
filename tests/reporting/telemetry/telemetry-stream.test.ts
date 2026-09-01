import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { join } from "node:path";
import * as fs from "node:fs";
import {
  clearInMemoryTelemetrySink,
  disableInMemoryTelemetrySink,
  emitTelemetryEvent,
  enableInMemoryTelemetrySink,
  getInMemoryTelemetrySink,
  isInMemoryTelemetrySinkEnabled,
  readTelemetryStream,
  resolveTelemetryFilePath,
  type TelemetryEvent,
} from "../../../olt/scripts/src/reporting/telemetry-stream.ts";

export const telemetryStreamSuiteName = "reporting/telemetry-stream";

describe(telemetryStreamSuiteName, () => {
  const virtualDir = "/virtual/telemetry-test-repo";

  beforeEach(() => {
    enableInMemoryTelemetrySink();
  });

  afterEach(() => {
    clearInMemoryTelemetrySink();
    disableInMemoryTelemetrySink();
  });

  it("resolves default and custom telemetry file paths", () => {
    const customPath = join(virtualDir, "custom", "telemetry.jsonl");
    const resolvedCustom = resolveTelemetryFilePath(virtualDir, customPath);
    expect(resolvedCustom).toBe(customPath);

    const resolvedDefault = resolveTelemetryFilePath(virtualDir);
    expect(resolvedDefault).toContain("telemetry.jsonl");
  });

  it("verifies in-memory sink enablement and state helpers", () => {
    expect(isInMemoryTelemetrySinkEnabled()).toBe(true);
    const sink = getInMemoryTelemetrySink();
    expect(sink).toBeDefined();

    clearInMemoryTelemetrySink();
    expect(sink?.size).toBe(0);

    disableInMemoryTelemetrySink();
    expect(isInMemoryTelemetrySinkEnabled()).toBe(false);
    expect(getInMemoryTelemetrySink()).toBeUndefined();
  });

  it("emits events and reads back telemetry event stream in-memory", () => {
    const customPath = join(virtualDir, "events", "stream.jsonl");
    const event1: TelemetryEvent = {
      timestamp: "2026-08-24T00:00:00.000Z",
      actor: "impl-1",
      task_id: "task-1",
      wave: 1,
      action: "write_to_file",
      token_estimate: 150,
      status: "success",
      details: { file: "src/index.ts" },
    };

    const event2: TelemetryEvent = {
      timestamp: "2026-08-24T00:01:00.000Z",
      actor: "val-1",
      action: "validate",
      status: "failure",
    };

    emitTelemetryEvent(event1, virtualDir, customPath);
    emitTelemetryEvent(event2, virtualDir, customPath);

    const stream = readTelemetryStream(virtualDir, customPath);
    expect(stream.length).toBe(2);
    expect(stream[0]?.actor).toBe("impl-1");
    expect(stream[0]?.task_id).toBe("task-1");
    expect(stream[0]?.token_estimate).toBe(150);
    expect(stream[1]?.actor).toBe("val-1");
    expect(stream[1]?.status).toBe("failure");
  });

  it("returns empty array if telemetry file does not exist in-memory", () => {
    const nonExistent = join(virtualDir, "nonexistent.jsonl");
    const stream = readTelemetryStream(virtualDir, nonExistent);
    expect(stream).toEqual([]);
  });

  it("skips malformed and incomplete JSON lines in in-memory telemetry buffer", () => {
    const filePath = join(virtualDir, "malformed.jsonl");
    const sink = getInMemoryTelemetrySink();
    expect(sink).toBeDefined();

    sink?.set(filePath, [
      JSON.stringify({
        timestamp: "2026-08-24T00:00:00.000Z",
        actor: "agent-1",
        action: "start",
        status: "success",
      }),
      "NOT_JSON",
      JSON.stringify({ actor: "missing_timestamp" }),
      JSON.stringify({ timestamp: "2026-08-24T00:01:00.000Z" }), // missing actor
      JSON.stringify({
        timestamp: "2026-08-24T00:02:00.000Z",
        actor: "agent-2",
        action: "finish",
        status: "success",
      }),
      "",
    ]);

    const stream = readTelemetryStream(virtualDir, filePath);
    expect(stream.length).toBe(2);
    expect(stream[0]?.actor).toBe("agent-1");
    expect(stream[1]?.actor).toBe("agent-2");
  });

  it("gracefully catches errors during fallback disk emit and read without crashing", () => {
    disableInMemoryTelemetrySink();

    const existsSpy = spyOn(fs, "existsSync").mockReturnValue(true);
    const appendSpy = spyOn(fs, "appendFileSync").mockImplementation(() => {
      throw new Error("Simulated append failure");
    });
    const readSpy = spyOn(fs, "readFileSync").mockImplementation(() => {
      throw new Error("Simulated read failure");
    });

    const invalidFilePath = join(virtualDir, "error.jsonl");
    expect(() => {
      emitTelemetryEvent(
        {
          timestamp: "2026-08-24T00:00:00.000Z",
          actor: "agent-1",
          action: "test",
          status: "success",
        },
        virtualDir,
        invalidFilePath,
      );
    }).not.toThrow();

    const res = readTelemetryStream(virtualDir, invalidFilePath);
    expect(res).toEqual([]);

    existsSpy.mockRestore();
    appendSpy.mockRestore();
    readSpy.mockRestore();
  });
});
