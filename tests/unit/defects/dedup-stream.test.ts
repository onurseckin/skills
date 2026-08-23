import { describe, expect, test } from "bun:test";
import {
  deduplicateDefectLog,
  parseAndDeduplicateDefectJsonl,
  serializeAggregatedDefectLog,
} from "../../../olt/scripts/src/mind/defects/dedup-stream.ts";
import type { DefectRecordInput } from "../../../olt/scripts/src/mind/defects/types.ts";

describe("Defect Stream Deduplication & Serialization", () => {
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
        }, // Within 1 min
        {
          type: "test_failure",
          observation: "Failed assertion",
          timestamp: "2026-08-22T08:05:00.000Z",
        }, // Outside 1 min
      ];

      const result = deduplicateDefectLog(defects, { strategy: "windowed", windowMs: 60_000 });
      expect(result.length).toBe(2);
      expect(result[0]?.count).toBe(2);
      expect(result[1]?.count).toBe(1);
    });
  });

  describe("parseAndDeduplicateDefectJsonl", () => {
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
  });

  describe("serializeAggregatedDefectLog", () => {
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
});
