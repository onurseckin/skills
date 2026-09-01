import { describe, expect, it, test } from "bun:test";
import {
  createDefectDedupTransformStream,
  deduplicateDefectLog,
  filterDefectStream,
  parseAndDeduplicateDefectJsonl,
  serializeAggregatedDefectLog,
  streamDeduplicateDefects,
  toAggregatedDefect,
} from "../../../olt/scripts/src/mind/defects/index.ts";
import type {
  AggregatedDefect,
  DefectRecordInput,
} from "../../../olt/scripts/src/mind/defects/core/index.ts";

export const dedupStreamSuiteName = "Defect Stream Deduplication & Serialization";

describe(dedupStreamSuiteName, () => {
  describe("deduplicateDefectLog", () => {
    test("handles empty inputs safely", () => {
      expect(deduplicateDefectLog([])).toEqual([]);
    });

    test("aggregates duplicate defects synchronously by default", () => {
      const defects: DefectRecordInput[] = [
        {
          id: "b-1",
          type: "main_thread_direct_execution",
          observation: "Direct execution without delegation",
          timestamp: "2026-08-22T08:00:00.000Z",
        },
        {
          id: "b-2",
          type: "main_thread_direct_execution",
          observation: "Direct execution without delegation",
          timestamp: "2026-08-22T08:01:00.000Z",
        },
        {
          id: "b-3",
          type: "syntax_error",
          observation: "Missing semicolon",
          timestamp: "2026-08-22T08:02:00.000Z",
        },
        {
          id: "b-4",
          type: "main_thread_direct_execution",
          observation: "Direct execution without delegation",
          timestamp: "2026-08-22T08:03:00.000Z",
        },
      ];

      const result = deduplicateDefectLog(defects);

      expect(result.length).toBe(2);

      const mainThreadDefect = result.find((r) => r.type === "main_thread_direct_execution");
      expect(mainThreadDefect !== undefined).toBeTrue();
      if (mainThreadDefect) {
        expect(mainThreadDefect.count).toBe(3);
        expect(mainThreadDefect.first_seen_at).toBe("2026-08-22T08:00:00.000Z");
        expect(mainThreadDefect.last_seen_at).toBe("2026-08-22T08:03:00.000Z");
      }

      const syntaxDefect = result.find((r) => r.type === "syntax_error");
      expect(syntaxDefect !== undefined).toBeTrue();
      if (syntaxDefect) {
        expect(syntaxDefect.count).toBe(1);
      }
    });

    test("respects exact_dedup strategy", () => {
      const defects: DefectRecordInput[] = [
        {
          type: "test_failure",
          observation: "Failed assertion",
          timestamp: "2026-08-22T08:00:00.000Z",
        },
        {
          type: "test_failure",
          observation: "Failed assertion",
          timestamp: "2026-08-22T08:01:00.000Z",
        },
      ];

      const result = deduplicateDefectLog(defects, { strategy: "exact_dedup" });
      expect(result.length).toBe(1);
      expect(result[0]?.count).toBe(1);
    });

    test("respects windowed strategy", () => {
      const defects: DefectRecordInput[] = [
        {
          type: "test_failure",
          observation: "Failed assertion",
          timestamp: "2026-08-22T08:00:00.000Z",
        },
        {
          type: "test_failure",
          observation: "Failed assertion",
          timestamp: "2026-08-22T08:00:30.000Z",
        },
        {
          type: "test_failure",
          observation: "Failed assertion",
          timestamp: "2026-08-22T08:05:00.000Z",
        },
      ];

      const result = deduplicateDefectLog(defects, { strategy: "windowed", windowMs: 60_000 });
      expect(result.length).toBe(2);
      expect(result[0]?.count).toBe(2);
      expect(result[1]?.count).toBe(1);
    });

    test("deduplicates logs with sliding_window_hash strategy", () => {
      const inputs: DefectRecordInput[] = [
        {
          type: "drift",
          observation: "Planning drift",
          timestamp: "2026-08-22T10:00:00.000Z",
        },
        {
          type: "drift",
          observation: "Planning drift",
          timestamp: "2026-08-22T10:00:30.000Z",
        },
      ];

      const hashWindowed = deduplicateDefectLog(inputs, {
        strategy: "sliding_window_hash",
        windowMs: 60_000,
      });
      expect(hashWindowed).toHaveLength(1);
      expect(hashWindowed[0]?.count).toBe(2);
    });
  });

  describe("parseAndDeduplicateDefectJsonl & serializeAggregatedDefectLog", () => {
    test("parses raw JSONL with malformed lines and deduplicates cleanly", () => {
      const jsonl = [
        "not json",
        JSON.stringify({ type: "role_leak", observation: "Orch edit" }),
        "42",
        JSON.stringify({ type: "role_leak", observation: "Orch edit" }),
        "",
        JSON.stringify({ type: "lint_error", observation: "Unused import" }),
      ].join("\n");

      const result = parseAndDeduplicateDefectJsonl(jsonl);
      expect(result.length).toBe(2);
      expect(result.find((r) => r.type === "role_leak")?.count).toBe(2);
      expect(result.find((r) => r.type === "lint_error")?.count).toBe(1);
    });

    test("serializes array into valid JSONL with trailing newline", () => {
      const aggregated = deduplicateDefectLog([
        { type: "error_1", observation: "Obs 1" },
        { type: "error_2", observation: "Obs 2" },
      ]);

      const serialized = serializeAggregatedDefectLog(aggregated);
      expect(serialized.endsWith("\n")).toBeTrue();

      const lines = serialized.trim().split("\n");
      expect(lines.length).toBe(2);

      const reparsed = parseAndDeduplicateDefectJsonl(serialized);
      expect(reparsed.length).toBe(2);
    });
  });

  describe("stream processing", () => {
    it("processes asynchronous stream with streamDeduplicateDefects", async () => {
      async function* makeStream(): AsyncGenerator<string, void, unknown> {
        yield JSON.stringify({ type: "stream_err", observation: "Stream error 1" });
        yield JSON.stringify({ type: "stream_err", observation: "Stream error 1" });
        yield JSON.stringify({ type: "stream_err", observation: "Stream error 2" });
      }

      const results: AggregatedDefect[] = [];
      for await (const entry of streamDeduplicateDefects(makeStream(), { windowMs: 60_000 })) {
        results.push(entry);
      }

      expect(results.length).toBe(3);
      const lastOccurrence = results.find(
        (r) => r.observation === "Stream error 1" && r.count === 2,
      );
      expect(lastOccurrence).toBeDefined();
    });

    it("processes stream through TransformStream", async () => {
      const transformStream = createDefectDedupTransformStream({ windowMs: 60_000 });

      const readable = new ReadableStream<string>({
        start(controller) {
          controller.enqueue(JSON.stringify({ type: "pipe_err", observation: "Piped error" }));
          controller.enqueue(JSON.stringify({ type: "pipe_err", observation: "Piped error" }));
          controller.close();
        },
      });

      const transformed = readable.pipeThrough(transformStream);
      const reader = transformed.getReader();
      const outputs: AggregatedDefect[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) outputs.push(value);
      }

      expect(outputs.length).toBe(2);
      expect(outputs[1]?.count).toBe(2);
    });

    it("filters defect stream by category, status, and agentId", () => {
      const list: AggregatedDefect[] = [
        toAggregatedDefect({
          type: "b1",
          category: "boundary_violation",
          status: "open",
          agent_id: "agent-x",
        }),
        toAggregatedDefect({
          type: "b2",
          category: "code_defect",
          status: "resolved",
          agent_id: "agent-y",
        }),
      ];

      const filteredBoundary = filterDefectStream(list, { category: "boundary_violation" });
      expect(filteredBoundary).toHaveLength(1);
      expect(filteredBoundary[0]?.agent_id).toBe("agent-x");

      const filteredResolved = filterDefectStream(list, { status: "resolved" });
      expect(filteredResolved).toHaveLength(1);
      expect(filteredResolved[0]?.agent_id).toBe("agent-y");
    });
  });
});
