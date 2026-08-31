/**
 * @file dedup-stream.test.ts
 * Unit tests for Defect Deduplication Streams, Windowing, and Transform Pipelines
 */

import { describe, expect, it } from "bun:test";
import {
  createDefectDedupTransformStream,
  deduplicateDefectLog,
  filterDefectStream,
  parseAndDeduplicateDefectJsonl,
  serializeAggregatedDefectLog,
  streamDeduplicateDefects,
} from "../../../../olt/scripts/src/mind/defects/dedup/index.ts";
import { toAggregatedDefect } from "../../../../olt/scripts/src/mind/defects/aggregator/index.ts";
import type {
  AggregatedDefect,
  DefectRecordInput,
} from "../../../../olt/scripts/src/mind/defects/core/index.ts";

describe("Defect Deduplication Streams Suite", () => {
  const sampleDefects: DefectRecordInput[] = [
    {
      type: "syntax_error",
      observation: "Unmatched token",
      agent_id: "agent-1",
      timestamp: "2026-08-24T10:00:00.000Z",
    },
    {
      type: "syntax_error",
      observation: "Unmatched token",
      agent_id: "agent-1",
      timestamp: "2026-08-24T10:00:10.000Z",
    },
    {
      type: "network_error",
      observation: "ECONNREFUSED",
      agent_id: "agent-2",
      timestamp: "2026-08-24T10:01:00.000Z",
    },
  ];

  describe("deduplicateDefectLog", () => {
    it("returns empty array for empty inputs", () => {
      expect(deduplicateDefectLog([])).toEqual([]);
    });

    it("deduplicates using default aggregate_synchronous strategy and triggers hooks", () => {
      let newCount = 0;
      let dedupCount = 0;

      const result = deduplicateDefectLog(sampleDefects, {
        onNewDefect: () => {
          newCount += 1;
        },
        onDefectDeduplicated: () => {
          dedupCount += 1;
        },
      });

      expect(result.length).toBe(2);
      expect(newCount).toBe(2);
      expect(dedupCount).toBe(1);
      expect(result[0]?.count).toBe(2);
    });

    it("supports exact_dedup strategy", () => {
      const result = deduplicateDefectLog(sampleDefects, { strategy: "exact_dedup" });
      expect(result.length).toBe(2);
      expect(result[0]?.count).toBe(1);
    });

    it("supports windowed strategy with hooks", () => {
      let windowedDedup = 0;
      let windowedNew = 0;
      const result = deduplicateDefectLog(sampleDefects, {
        strategy: "windowed",
        windowMs: 60_000,
        onDefectDeduplicated: () => {
          windowedDedup += 1;
        },
        onNewDefect: () => {
          windowedNew += 1;
        },
      });
      expect(result.length).toBe(2);
      expect(windowedDedup).toBe(1);
      expect(windowedNew).toBe(2);

      const resultNarrow = deduplicateDefectLog(sampleDefects, {
        strategy: "windowed",
        windowMs: 5000,
      });
      expect(resultNarrow.length).toBe(3);
    });

    it("supports sliding_window_hash strategy", () => {
      const result = deduplicateDefectLog(sampleDefects, {
        strategy: "sliding_window_hash",
        windowMs: 60_000,
      });
      expect(result.length).toBe(2);
      expect(result[0]?.count).toBe(2);
    });
  });

  describe("parseAndDeduplicateDefectJsonl and serializeAggregatedDefectLog", () => {
    it("parses valid JSONL and ignores blank/corrupt lines", () => {
      const jsonl = [
        "",
        JSON.stringify(sampleDefects[0]),
        "corrupted json line {[[",
        JSON.stringify(sampleDefects[1]),
        "   ",
        JSON.stringify(sampleDefects[2]),
      ].join("\n");

      const result = parseAndDeduplicateDefectJsonl(jsonl);
      expect(result.length).toBe(2);
    });

    it("returns empty array on empty input", () => {
      expect(parseAndDeduplicateDefectJsonl("")).toEqual([]);
    });

    it("serializes aggregated defects to JSONL", () => {
      const aggregated = sampleDefects.map((d) => toAggregatedDefect(d));
      const serialized = serializeAggregatedDefectLog(aggregated);

      expect(typeof serialized).toBe("string");
      expect(serialized.split("\n").filter((l) => l.trim()).length).toBe(3);
      expect(serializeAggregatedDefectLog([])).toBe("");
    });
  });

  describe("streamDeduplicateDefects", () => {
    it("streams and deduplicates strings and object chunks with window and maxEntries", async () => {
      async function* generateChunks() {
        yield JSON.stringify(sampleDefects[0]);
        yield "invalid json";
        yield "   ";
        yield sampleDefects[1]!;
        yield sampleDefects[2]!;
        yield { type: "third_defect", observation: "third", timestamp: "2026-08-24T10:05:00Z" };
      }

      const results: AggregatedDefect[] = [];
      for await (const defect of streamDeduplicateDefects(generateChunks(), {
        windowMs: 60_000,
        maxEntries: 2,
      })) {
        results.push(defect);
      }

      expect(results.length).toBe(4);
      expect(results[1]?.count).toBe(2);
    });
  });

  describe("createDefectDedupTransformStream", () => {
    it("transforms chunks and evicts oldest when exceeding maxEntries", async () => {
      const transform = createDefectDedupTransformStream({
        windowMs: 60_000,
        maxEntries: 2,
      });

      const inputStream = new ReadableStream<string | DefectRecordInput>({
        start(controller) {
          controller.enqueue(JSON.stringify(sampleDefects[0]));
          controller.enqueue("   ");
          controller.enqueue("invalid json {");
          controller.enqueue(sampleDefects[1]!);
          controller.enqueue(sampleDefects[2]!);
          controller.enqueue({ type: "third_defect", observation: "third" });
          controller.close();
        },
      });

      const outputStream = inputStream.pipeThrough(transform);
      const reader = outputStream.getReader();

      const items: AggregatedDefect[] = [];
      let done = false;
      while (!done) {
        const read = await reader.read();
        if (read.done) {
          done = true;
        } else if (read.value) {
          items.push(read.value);
        }
      }

      expect(items.length).toBe(4);
      expect(items[1]?.count).toBe(2);
    });
  });

  describe("filterDefectStream", () => {
    it("filters defects by category, status, and agentId", () => {
      const list: AggregatedDefect[] = [
        toAggregatedDefect({
          category: "code_defect",
          status: "open",
          severity: "high",
          agent_id: "agent-1",
        }),
        toAggregatedDefect({
          category: "boundary_violation",
          status: "resolved",
          severity: "low",
          agent_id: "agent-2",
        }),
      ];

      const byCat = filterDefectStream(list, { category: "code_defect" });
      expect(byCat.length).toBe(1);
      expect(byCat[0]?.category).toBe("code_defect");

      const byStat = filterDefectStream(list, { status: "resolved" });
      expect(byStat.length).toBe(1);
      expect(byStat[0]?.status).toBe("resolved");

      const byAgent = filterDefectStream(list, { agentId: "agent-1" });
      expect(byAgent.length).toBe(1);
      expect(byAgent[0]?.agent_id).toBe("agent-1");
    });
  });
});
