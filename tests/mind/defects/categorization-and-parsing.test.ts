/**
 * @file categorization-and-parsing.test.ts
 * Unit tests for Defect Categorization, JSONL Parsing, and Serialization
 */

import { describe, expect, it } from "bun:test";
import {
  categorizeDefect,
  parseDefectLog,
  serializeDefectLog,
  type DefectEntry,
} from "../../../../olt/scripts/src/mind/defects/index.ts";
import { createMockDefectEntry } from "./defect-fixture.ts";

describe("Defect Categorization & Log Serialization", () => {
  describe("categorizeDefect", () => {
    it("preserves existing valid categories", () => {
      expect(categorizeDefect({ category: "code_defect" })).toBe("code_defect");
      expect(categorizeDefect({ category: "model_reasoning_error" })).toBe("model_reasoning_error");
      expect(categorizeDefect({ category: "boundary_violation" })).toBe("boundary_violation");
      expect(categorizeDefect({ category: "process_gap" })).toBe("process_gap");
      expect(categorizeDefect({ category: "flakiness" })).toBe("flakiness");
      expect(categorizeDefect({ category: "dependency_drift" })).toBe("dependency_drift");
    });

    it("infers category from error messages and descriptions", () => {
      expect(categorizeDefect({ description: "SyntaxError: Unexpected token in JSON" })).toBe(
        "code_defect",
      );
      expect(
        categorizeDefect({ description: "TypeError: Cannot read properties of undefined" }),
      ).toBe("code_defect");
      expect(categorizeDefect({ description: "Model hallucinated invalid tool argument" })).toBe(
        "model_reasoning_error",
      );
      expect(categorizeDefect({ description: "Permission denied write outside bounds" })).toBe(
        "boundary_violation",
      );
      expect(categorizeDefect({ description: "Intermittent timeout after 5000ms" })).toBe(
        "flakiness",
      );
      expect(categorizeDefect({ description: "Missing mandatory step in protocol" })).toBe(
        "process_gap",
      );
      expect(categorizeDefect({ description: "Package version mismatch in lockfile" })).toBe(
        "dependency_drift",
      );
    });

    it("defaults to code_defect when unclassifiable", () => {
      expect(categorizeDefect({})).toBe("code_defect");
      expect(categorizeDefect({ description: "Miscellaneous issue occurred" })).toBe("code_defect");
    });
  });

  describe("parseDefectLog", () => {
    it("parses valid JSONL log strings into strongly-typed DefectEntry arrays", () => {
      const e1 = createMockDefectEntry({ id: "def-101", title: "Bug 1" });
      const e2 = createMockDefectEntry({ id: "def-102", title: "Bug 2" });
      const jsonl = `${JSON.stringify(e1)}\n${JSON.stringify(e2)}`;

      const parsed = parseDefectLog(jsonl);
      expect(parsed.length).toBe(2);
      expect(parsed[0]?.id).toBe("def-101");
      expect(parsed[1]?.id).toBe("def-102");
    });

    it("tolerates dirty lines, whitespace, and skips malformed JSON entries", () => {
      const valid = createMockDefectEntry({ id: "def-clean" });
      const dirtyLog = `\n   \n${JSON.stringify(valid)}\n{broken json\n`;

      const parsed = parseDefectLog(dirtyLog);
      expect(parsed.length).toBe(1);
      expect(parsed[0]?.id).toBe("def-clean");
    });

    it("handles empty log strings and undefined inputs gracefully", () => {
      expect(parseDefectLog("")).toEqual([]);
      expect(parseDefectLog("   \n\n  ")).toEqual([]);
    });

    it("normalizes and sanitizes missing optional fields", () => {
      const minimal = { id: "def-min", title: "Minimal bug" };
      const parsed = parseDefectLog(JSON.stringify(minimal));
      expect(parsed.length).toBe(1);
      expect(parsed[0]?.status).toBe("open");
      expect(parsed[0]?.severity).toBe("P2");
      expect(parsed[0]?.category).toBe("code_defect");
    });
  });

  describe("serializeDefectLog", () => {
    it("serializes entries to canonical newline-delimited JSON format", () => {
      const entries: DefectEntry[] = [
        createMockDefectEntry({ id: "def-1", title: "First" }),
        createMockDefectEntry({ id: "def-2", title: "Second" }),
      ];

      const serialized = serializeDefectLog(entries);
      expect(serialized).toContain('"id":"def-1"');
      expect(serialized).toContain('"id":"def-2"');
      expect(serialized.split("\n").filter((l) => l.trim().length > 0).length).toBe(2);
    });

    it("round-trips serialize and parse without data loss", () => {
      const original: DefectEntry[] = [
        createMockDefectEntry({ id: "def-rt-1", severity: "P0", category: "boundary_violation" }),
        createMockDefectEntry({ id: "def-rt-2", severity: "P3", category: "flakiness" }),
      ];

      const jsonl = serializeDefectLog(original);
      const parsed = parseDefectLog(jsonl);
      expect(parsed.length).toBe(2);
      expect(parsed[0]?.id).toBe(original[0]?.id);
      expect(parsed[0]?.severity).toBe(original[0]?.severity);
      expect(parsed[1]?.category).toBe(original[1]?.category);
    });
  });
});
