import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  emitTelemetryEvent,
  readTelemetryStream,
  resolveTelemetryFilePath,
  type TelemetryEvent,
} from "../../../olt/scripts/src/reporting/telemetry-stream.ts";

export const telemetryStreamSuiteName = "reporting/telemetry-stream";

describe(telemetryStreamSuiteName, () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `telemetry-stream-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("resolves default and custom telemetry file paths", () => {
    const customPath = join(tempDir, "custom", "telemetry.jsonl");
    const resolvedCustom = resolveTelemetryFilePath(tempDir, customPath);
    expect(resolvedCustom).toBe(customPath);

    const resolvedDefault = resolveTelemetryFilePath(tempDir);
    expect(resolvedDefault).toContain("telemetry.jsonl");
  });

  it("emits events and reads back telemetry event stream", () => {
    const customPath = join(tempDir, "events", "stream.jsonl");
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

    emitTelemetryEvent(event1, tempDir, customPath);
    emitTelemetryEvent(event2, tempDir, customPath);

    const stream = readTelemetryStream(tempDir, customPath);
    expect(stream.length).toBe(2);
    expect(stream[0]?.actor).toBe("impl-1");
    expect(stream[0]?.task_id).toBe("task-1");
    expect(stream[0]?.token_estimate).toBe(150);
    expect(stream[1]?.actor).toBe("val-1");
    expect(stream[1]?.status).toBe("failure");
  });

  it("returns empty array if telemetry file does not exist", () => {
    const nonExistent = join(tempDir, "nonexistent.jsonl");
    const stream = readTelemetryStream(tempDir, nonExistent);
    expect(stream).toEqual([]);
  });

  it("skips malformed and incomplete JSON lines in telemetry file", () => {
    const filePath = join(tempDir, "malformed.jsonl");
    const content = [
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
    ].join("\n");

    writeFileSync(filePath, content, "utf-8");

    const stream = readTelemetryStream(tempDir, filePath);
    expect(stream.length).toBe(2);
    expect(stream[0]?.actor).toBe("agent-1");
    expect(stream[1]?.actor).toBe("agent-2");
  });

  it("gracefully catches filesystem errors during emit and read without crashing", () => {
    // Attempting to emit to a directory path instead of a file
    const invalidFilePath = tempDir;
    expect(() => {
      emitTelemetryEvent(
        {
          timestamp: "2026-08-24T00:00:00.000Z",
          actor: "agent-1",
          action: "test",
          status: "success",
        },
        tempDir,
        invalidFilePath,
      );
    }).not.toThrow();

    // Attempting to read a directory path instead of a file triggers readFileSync catch block
    const res = readTelemetryStream(tempDir, invalidFilePath);
    expect(res).toEqual([]);
  });
});
