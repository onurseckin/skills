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
} from "../../../olt/scripts/src/mind/defects/index.ts";
import { createMockDefectEntry } from "./defect-fixture.ts";

describe("Defect Categorization & Log Serialization", () => {
  describe("categorizeDefect", () => {
    it("preserves existing valid categories", () => {
      expect(categorizeDefect({ category: "code_defect" })).toBe("code_defect");
      expect(categorizeDefect({ category: "model_reasoning_error" })).toBe("model_reasoning_error");
      expect(categorizeDefect({ category: "boundary_violation" })).toBe("boundary_violation");
      expect(categorizeDefect({ category: "documentation" })).toBe("documentation");
      expect(categorizeDefect({ category: "security_risk" })).toBe("security_risk");
      expect(categorizeDefect({ category: "modularity_violation" })).toBe("modularity_violation");
    });

    it("infers category from error messages and descriptions", () => {
      expect(categorizeDefect({ observation: "syntax error unexpected token in JSON" })).toBe("code_defect");
      expect(categorizeDefect({ observation: "hallucination in model prompt generation" })).toBe("model_reasoning_error");
      expect(categorizeDefect({ observation: "permission denied breach of container bounds" })).toBe("boundary_violation");
      expect(categorizeDefect({ observation: "unauthorized file access escalation" })).toBe("boundary_violation");
    });

    it("defaults to code_defect when unclassifiable", () => {
      expect(categorizeDefect({})).toBe("code_defect");
      expect(categorizeDefect({ observation: "Miscellaneous issue occurred" })).toBe("code_defect");
    });
  });

  describe("parseDefectLog", () => {
    it("parses valid JSONL log strings into strongly-typed DefectEntry arrays", () => {
      const e1 = createMockDefectEntry({ id: "def-101", observation: "Bug 1" });
      const e2 = createMockDefectEntry({ id: "def-102", observation: "Bug 2" });
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
      const minimal = { id: "def-min", message: "Minimal bug" };
      const parsed = parseDefectLog(JSON.stringify(minimal));
      expect(parsed.length).toBe(1);
      expect(parsed[0]?.status).toBe("open");
      expect(parsed[0]?.severity).toBe("warning");
      expect(parsed[0]?.category).toBe("code_defect");
    });
  });

  describe("serializeDefectLog", () => {
    it("serializes entries to canonical newline-delimited JSON format", () => {
      const entries: DefectEntry[] = [
        createMockDefectEntry({ id: "def-1", observation: "First" }),
        createMockDefectEntry({ id: "def-2", observation: "Second" }),
      ];

      const serialized = serializeDefectLog(entries);
      expect(serialized).toContain('"id":"def-1"');
      expect(serialized).toContain('"id":"def-2"');
      expect(serialized.split("\n").filter((l) => l.trim().length > 0).length).toBe(2);
    });

    it("round-trips serialize and parse without data loss", () => {
      const original: DefectEntry[] = [
        createMockDefectEntry({ id: "def-rt-1", severity: "critical", category: "boundary_violation" }),
        createMockDefectEntry({ id: "def-rt-2", severity: "low", category: "documentation" }),
      ];

      const jsonl = serializeDefectLog(original);
      const parsed = parseDefectLog(jsonl);
      expect(parsed.length).toBe(2);
      expect(parsed[0]?.id).toBe(original[0]?.id);
      expect(parsed[0]?.severity).toBe(original[0]?.severity);
      expect(parsed[0]?.category).toBe(original[0]?.category);
      expect(parsed[1]?.category).toBe(original[1]?.category);
    });
  });
});
