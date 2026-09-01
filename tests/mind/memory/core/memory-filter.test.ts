/**
 * Unit Test Suite for Multi-Attribute Filtering and Search Pattern Compilation.
 * Covers kind, capsule, generation, tag, and pattern filters in searchMemory and BM25 scoring.
 */

import { describe, expect, it } from "bun:test";
import {
  extractSnippet as extractSnippetBM25,
  scoreDocumentBM25,
} from "../../../../olt/scripts/src/mind/memory/core/bm25.ts";
import { searchMemory } from "../../../../olt/scripts/src/mind/memory/core/search.ts";
import {
  buildMemoryIndex,
  compileSearchPattern,
  createMemoryDocument,
} from "../../../../olt/scripts/src/mind/memory/core/storage.ts";
import type {
  MemoryDocument,
  MemoryIndex,
} from "../../../../olt/scripts/src/mind/memory/core/types.ts";

describe("Memory Filtering & Pattern Engine", () => {
  const docs: MemoryDocument[] = [
    createMemoryDocument({
      id: "doc-charter",
      kind: "charter",
      title: "Core System Invariant",
      capsule_id: "mind-gen-1",
      generation: 1,
      tags: ["kernel", "invariant", "core"],
      source_path: "olt/agents/mind.yaml",
      content: "Core architectural invariant rules.",
    }),
    createMemoryDocument({
      id: "doc-defect",
      kind: "defect",
      title: "Null Pointer Exception in Pipeline",
      capsule_id: "mind-gen-2",
      generation: 2,
      tags: ["defect", "pipeline", "null"],
      source_path: "olt/defects/defects.jsonl",
      content: "Null pointer occurred during pipeline execution.",
    }),
    createMemoryDocument({
      id: "doc-decision",
      kind: "decision",
      title: "Select Strategy Pattern",
      capsule_id: "capsule-gen-3",
      generation: 3,
      tags: ["decision", "pattern", "strategy"],
      source_path: "olt/capsules/capsule-gen-3/state.json",
      content: "Adopted strategy pattern for modular pipelines.",
    }),
    createMemoryDocument({
      id: "doc-unattached",
      kind: "report",
      title: "Standalone Diagnostic Report",
      capsule_id: null,
      generation: null,
      tags: ["report", "diagnostic"],
      source_path: "diagnostics.txt",
      content: "Global unattached diagnostic summary.",
    }),
  ];

  const index: MemoryIndex = buildMemoryIndex(docs);

  describe("Kind Filter", () => {
    it("filters by kind array and comma-separated string", () => {
      const byArray = searchMemory(index, { query: "", kind: ["defect", "decision"] });
      expect(byArray.map((r) => r.id).sort()).toEqual(["doc-decision", "doc-defect"]);

      const byString = searchMemory(index, { query: "", kind: "charter, defect" });
      expect(byString.map((r) => r.id).sort()).toEqual(["doc-charter", "doc-defect"]);
    });

    it("ignores kind filter when set to 'all' or empty string", () => {
      const allRes = searchMemory(index, { query: "", kind: "all" });
      expect(allRes.length).toBe(4);

      const emptyRes = searchMemory(index, { query: "", kind: "" });
      expect(emptyRes.length).toBe(4);
    });
  });

  describe("Capsule Filter", () => {
    it("filters by capsule string and array case-insensitively", () => {
      const res = searchMemory(index, { query: "", capsule: "MIND-GEN-1" });
      expect(res.length).toBe(1);
      expect(res[0]?.id).toBe("doc-charter");

      const resArr = searchMemory(index, { query: "", capsule: ["mind-gen-1", "capsule-gen-3"] });
      expect(resArr.map((r) => r.id).sort()).toEqual(["doc-charter", "doc-decision"]);
    });

    it("excludes documents with null capsule_id when capsule filter is specified", () => {
      const res = searchMemory(index, { query: "", capsule: "nonexistent-capsule" });
      expect(res).toEqual([]);
    });
  });

  describe("Generation Filter", () => {
    it("filters by exact number, array of numbers/strings, and pattern string", () => {
      const byNum = searchMemory(index, { query: "", generation: 2 });
      expect(byNum.length).toBe(1);
      expect(byNum[0]?.id).toBe("doc-defect");

      const byArr = searchMemory(index, { query: "", generation: [1, "3"] });
      expect(byArr.map((r) => r.id).sort()).toEqual(["doc-charter", "doc-decision"]);

      const byPatternStr = searchMemory(index, { query: "", generation: "gen-1, generation_2" });
      expect(byPatternStr.map((r) => r.id).sort()).toEqual(["doc-charter", "doc-defect"]);
    });

    it("skips documents without generation when generation filter is active", () => {
      const res = searchMemory(index, { query: "", generation: 99 });
      expect(res).toEqual([]);
    });
  });

  describe("Tag Filter", () => {
    it("filters by required tags and supports singular 'tag' option", () => {
      const res = searchMemory(index, { query: "", tags: ["kernel", "invariant"] });
      expect(res.length).toBe(1);
      expect(res[0]?.id).toBe("doc-charter");

      const resSingular = searchMemory(index, { query: "", tag: "strategy" });
      expect(resSingular.length).toBe(1);
      expect(resSingular[0]?.id).toBe("doc-decision");
    });

    it("matches tags via doc token matching when exact tag isn't in tag list", () => {
      const res = searchMemory(index, { query: "", tags: "modular" });
      expect(res.length).toBe(1);
      expect(res[0]?.id).toBe("doc-decision");
    });
  });

  describe("compileSearchPattern and Regex Filtering", () => {
    it("compiles regex with flags, string patterns, and handles malformed inputs", () => {
      expect(compileSearchPattern(undefined)).toBeNull();
      expect(compileSearchPattern("")).toBeNull();

      const directRegex = /test/g;
      expect(compileSearchPattern(directRegex)).toBe(directRegex);

      const slashRegex = compileSearchPattern("/pipeline/i");
      expect(slashRegex?.test("pipeline")).toBe(true);

      const slashRegexWithFlags = compileSearchPattern("/pipeline/m");
      expect(slashRegexWithFlags?.flags).toContain("m");

      const slashRegexEmptyFlags = compileSearchPattern("/pipeline/");
      expect(slashRegexEmptyFlags?.flags).toContain("i");

      const escapedRegex = compileSearchPattern("test[bracket");
      expect(escapedRegex?.test("test[bracket")).toBe(true);
    });

    it("filters documents against regex patterns across id, title, snippet, and source path", () => {
      const res = searchMemory(index, { query: "", pattern: "/diagnostics\\.txt$/" });
      expect(res.length).toBe(1);
      expect(res[0]?.id).toBe("doc-unattached");
    });
  });

  describe("BM25 Scoring Logic & Snippet Extraction", () => {
    it("returns zero score for empty query tokens or zero length doc", () => {
      expect(scoreDocumentBM25(docs[0]!, [], index)).toEqual({ score: 0, matchedTerms: [] });

      const emptyDoc = createMemoryDocument({
        id: "empty",
        kind: "report",
        title: "",
        source_path: "empty.txt",
        content: "",
      });
      expect(scoreDocumentBM25(emptyDoc, ["test"], index)).toEqual({ score: 0, matchedTerms: [] });
    });

    it("applies boosts for title, ID, and tag matches", () => {
      const titleMatch = scoreDocumentBM25(docs[1]!, ["pointer"], index);
      expect(titleMatch.score).toBeGreaterThan(0);
      expect(titleMatch.matchedTerms).toContain("pointer");

      const tagMatch = scoreDocumentBM25(docs[0]!, ["kernel"], index);
      expect(tagMatch.score).toBeGreaterThan(0);
      expect(tagMatch.matchedTerms).toContain("kernel");
    });

    it("validates BM25 module snippet extractor directly", () => {
      expect(extractSnippetBM25("", [])).toBe("");
      expect(extractSnippetBM25("short content", ["short"], 50)).toBe("short content");
      const long = "Header start. Important target keyword in middle. Footer conclusion.";
      expect(extractSnippetBM25(long, ["target"], 30)).toContain("target");
      expect(extractSnippetBM25(long, ["nonexistent"], 20)).toBe("Header start. Imp...");
    });
  });
});
