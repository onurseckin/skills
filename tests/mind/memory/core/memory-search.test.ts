/**
 * Unit Test Suite for Semantic Memory Search and Dynamic Snippet Extraction.
 * Covers searchMemory, queryMemory, and extractSnippet.
 */

import { describe, expect, it } from "bun:test";
import {
  extractSnippet,
  queryMemory,
  searchMemory,
} from "../../../../olt/scripts/src/mind/memory/core/search.ts";
import {
  buildMemoryIndex,
  createMemoryDocument,
} from "../../../../olt/scripts/src/mind/memory/core/storage.ts";
import type { MemoryIndex } from "../../../../olt/scripts/src/mind/memory/core/types.ts";

describe("Memory Search & Query Engine", () => {
  const doc1 = createMemoryDocument({
    id: "doc-arch-01",
    kind: "charter",
    title: "Kernel Architecture Invariants",
    capsule_id: "mind-gen-1",
    generation: 1,
    tags: ["kernel", "architecture", "invariants"],
    source_path: "olt/agents/mind.yaml",
    content: "The kernel maintains deterministic memory and invariant state synchronization.",
    snippet: "The kernel maintains deterministic memory.",
  });

  const doc2 = createMemoryDocument({
    id: "doc-defect-02",
    kind: "defect",
    title: "Memory Leak in Sandbox Stream",
    capsule_id: "run-p87-gen2",
    generation: 2,
    tags: ["defect", "memory", "stream"],
    source_path: "olt/defects/defects.jsonl",
    content: "Stream handler fails to release file descriptor causing memory degradation.",
    snippet: "Stream handler fails to release file descriptor.",
  });

  const doc3 = createMemoryDocument({
    id: "doc-decision-03",
    kind: "decision",
    title: "Adopt BM25 Indexing Engine",
    capsule_id: "mind-gen-3",
    generation: 3,
    tags: ["decision", "bm25", "search"],
    source_path: "olt/capsules/mind-gen-3/state.json",
    content: "We decided to implement BM25 with token-level postings and IDF ranking.",
    snippet: "Adopt BM25 for ranking search queries.",
  });

  const testIndex: MemoryIndex = buildMemoryIndex([doc1, doc2, doc3]);

  describe("searchMemory - Query & Ranking", () => {
    it("returns empty array for empty query when index has 0 documents", () => {
      const emptyIndex = buildMemoryIndex([]);
      const results = searchMemory(emptyIndex, { query: "" });
      expect(results).toEqual([]);
    });

    it("returns unranked documents with default scores on empty query", () => {
      const results = searchMemory(testIndex, { query: "" });
      expect(results.length).toBe(3);
      expect(results.every((r) => r.score >= 1.0)).toBe(true);
    });

    it("boosts empty query results when pattern and tags filters match", () => {
      const results = searchMemory(testIndex, {
        query: "",
        pattern: "kernel",
        tags: ["invariants"],
      });
      expect(results.length).toBe(1);
      expect(results[0]?.id).toBe("doc-arch-01");
      expect(results[0]?.score).toBe(3.5); // 1.0 base + 2.0 pattern + 0.5 tags
      expect(results[0]?.matched_terms[0]?.toLowerCase()).toBe("kernel");
    });

    it("ranks matching documents using BM25 relevance scores", () => {
      const results = searchMemory(testIndex, { query: "memory stream descriptor" });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.id).toBe("doc-defect-02");
      expect(results[0]?.matched_terms).toEqual(
        expect.arrayContaining(["memory", "stream", "descriptor"]),
      );
    });

    it("applies minScore filter to exclude low relevance matches", () => {
      const results = searchMemory(testIndex, { query: "memory", minScore: 100.0 });
      expect(results).toEqual([]);
    });

    it("paginates results using limit and offset", () => {
      const allResults = searchMemory(testIndex, { query: "" });
      expect(allResults.length).toBe(3);

      const paged = searchMemory(testIndex, { query: "", limit: 1, offset: 1 });
      expect(paged.length).toBe(1);
      expect(paged[0]?.id).toBe(allResults[1]?.id);
    });

    it("sorts by score descending, then matched terms length, then id", () => {
      const docA = createMemoryDocument({
        id: "doc-aaa",
        kind: "charter",
        title: "Same Score Alpha",
        source_path: "a.md",
        content: "token match",
      });
      const docB = createMemoryDocument({
        id: "doc-bbb",
        kind: "charter",
        title: "Same Score Beta",
        source_path: "b.md",
        content: "token match extra term",
      });
      const tieIndex = buildMemoryIndex([docB, docA]);

      const results = searchMemory(tieIndex, { query: "token match extra" });
      expect(results.length).toBe(2);
      expect(results[0]?.id).toBe("doc-bbb");
    });

    it("adds pattern match boost to BM25 query results", () => {
      const results = searchMemory(testIndex, {
        query: "indexing",
        pattern: "BM25",
      });
      expect(results.length).toBe(1);
      expect(results[0]?.id).toBe("doc-decision-03");
      expect(results[0]?.matched_terms).toContain("BM25");
    });
  });

  describe("queryMemory alias", () => {
    it("delegates directly to searchMemory", () => {
      const resSearch = searchMemory(testIndex, { query: "BM25" });
      const resQuery = queryMemory(testIndex, { query: "BM25" });
      expect(resQuery).toEqual(resSearch);
    });
  });

  describe("extractSnippet", () => {
    it("returns empty string for empty content", () => {
      expect(extractSnippet("", ["test"])).toBe("");
    });

    it("returns full trimmed content when shorter than maxLength", () => {
      const text = "Short concise statement.";
      expect(extractSnippet(text, ["concise"], 100)).toBe("Short concise statement.");
    });

    it("extracts contextual window around query term match", () => {
      const longText =
        "The starting preamble of the subsystem begins here. In the core component, we discovered critical memory corruption during stress testing. The conclusion follows after.";
      const snippet = extractSnippet(longText, ["memory", "corruption"], 50);
      expect(snippet.includes("memory corruption")).toBe(true);
      expect(snippet.startsWith("...")).toBe(true);
      expect(snippet.endsWith("...")).toBe(true);
    });

    it("truncates from start when no query tokens match", () => {
      const longText = "A".repeat(200);
      const snippet = extractSnippet(longText, ["nonexistent"], 60);
      expect(snippet.length).toBe(60);
      expect(snippet.endsWith("...")).toBe(true);
    });

    it("ignores single character query tokens in snippet locator", () => {
      const text = "Prefix ".repeat(10) + "TARGET_PHRASE" + " Suffix ".repeat(10);
      const snippet = extractSnippet(text, ["a", "TARGET_PHRASE"], 40);
      expect(snippet.includes("TARGET_PHRASE")).toBe(true);
    });
  });
});
