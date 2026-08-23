import { describe, expect, test } from "bun:test";
import {
  deduplicateBlunderLog,
  parseAndDeduplicateBlunderJsonl,
  serializeAggregatedBlunderLog,
} from "../../../orchestrating-long-tasks/scripts/src/blunders/dedup-stream.ts";
import type { BlunderRecordInput } from "../../../orchestrating-long-tasks/scripts/src/blunders/types.ts";

describe("Blunder Stream Deduplication & Serialization", () => {
  describe("deduplicateBlunderLog", () => {
    test("handles empty inputs safely", () => {
      expect(deduplicateBlunderLog([])).toEqual([]);
    });

    test("aggregates duplicate blunders synchronously by default", () => {
      const blunders: BlunderRecordInput[] = [
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

      const result = deduplicateBlunderLog(blunders);

      expect(result.length).toBe(2);

      const mainThreadBlunder = result.find((r) => r.type === "main_thread_direct_execution");
      expect(mainThreadBlunder !== undefined).toBeTrue();
      if (mainThreadBlunder) {
        expect(mainThreadBlunder.count).toBe(3);
        expect(mainThreadBlunder.first_seen_at).toBe("2026-08-22T08:00:00.000Z");
        expect(mainThreadBlunder.last_seen_at).toBe("2026-08-22T08:03:00.000Z");
      }

      const syntaxBlunder = result.find((r) => r.type === "syntax_error");
      expect(syntaxBlunder !== undefined).toBeTrue();
      if (syntaxBlunder) {
        expect(syntaxBlunder.count).toBe(1);
      }
    });

    test("respects exact_dedup strategy", () => {
      const blunders: BlunderRecordInput[] = [
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

      const result = deduplicateBlunderLog(blunders, { strategy: "exact_dedup" });
      expect(result.length).toBe(1);
      expect(result[0]?.count).toBe(1);
    });

    test("respects windowed strategy", () => {
      const blunders: BlunderRecordInput[] = [
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

      const result = deduplicateBlunderLog(blunders, { strategy: "windowed", windowMs: 60_000 });
      expect(result.length).toBe(2);
      expect(result[0]?.count).toBe(2);
      expect(result[1]?.count).toBe(1);
    });
  });

  describe("parseAndDeduplicateBlunderJsonl", () => {
    test("parses raw JSONL with malformed lines and deduplicates cleanly", () => {
      const jsonl = [
        "not json",
        JSON.stringify({ type: "role_leak", observation: "Orch edit" }),
        "42",
        JSON.stringify({ type: "role_leak", observation: "Orch edit" }),
        "",
        JSON.stringify({ type: "lint_error", observation: "Unused import" }),
      ].join("\n");

      const result = parseAndDeduplicateBlunderJsonl(jsonl);
      expect(result.length).toBe(2);
      expect(result.find((r) => r.type === "role_leak")?.count).toBe(2);
      expect(result.find((r) => r.type === "lint_error")?.count).toBe(1);
    });
  });

  describe("serializeAggregatedBlunderLog", () => {
    test("serializes array into valid JSONL with trailing newline", () => {
      const aggregated = deduplicateBlunderLog([
        { type: "error_1", observation: "Obs 1" },
        { type: "error_2", observation: "Obs 2" },
      ]);

      const serialized = serializeAggregatedBlunderLog(aggregated);
      expect(serialized.endsWith("\n")).toBeTrue();

      const lines = serialized.trim().split("\n");
      expect(lines.length).toBe(2);

      const reparsed = parseAndDeduplicateBlunderJsonl(serialized);
      expect(reparsed.length).toBe(2);
    });
  });
});
