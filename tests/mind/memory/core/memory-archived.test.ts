import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  formatMemoryQueryBrief,
  indexAllMemory,
  indexArchivedObjectiveDocuments,
  padRight,
  renderAsciiMemoryTable,
  truncateString,
} from "../../../../olt/scripts/src/mind/memory/core/archived.ts";
import type { MemoryQueryResult } from "../../../../olt/scripts/src/mind/memory/core/types.ts";
import { VirtualMemoryFS } from "../../../../olt/scripts/src/testing/virtual-fs/memory-fs.ts";
import { createVirtualFSSession } from "../../../../olt/scripts/src/testing/virtual-fs/spies.ts";

describe("Archived Objectives and Integrated Indexing (archived.ts)", () => {
  let vfs: VirtualMemoryFS;
  let session: ReturnType<typeof createVirtualFSSession>;
  const baseDir = "/virtual/mind-memory/archived";
  const capsulesDir = `${baseDir}/capsules`;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
    vfs.mkdirSync(capsulesDir, { recursive: true });
  });

  afterEach(() => {
    session.cleanup();
  });

  describe("indexArchivedObjectiveDocuments", () => {
    it("indexes archived records from root and capsule JSONL files in upper and lower case", () => {
      const capDir1 = `${capsulesDir}/mind-gen-3`;
      const capDir2 = `${capsulesDir}/mind-gen-4`;
      vfs.mkdirSync(capDir1, { recursive: true });
      vfs.mkdirSync(capDir2, { recursive: true });

      const rootJsonl = JSON.stringify({
        id: "OBJ-ROOT-1",
        statement: "Root init",
        result: "success",
        generation: 1,
        charter_goals: ["G1"],
      });
      const cap1Jsonl = JSON.stringify({
        id: "OBJ-CAP-1",
        statement: "Upper case archive",
        generation: 3,
      });
      const cap2Jsonl = JSON.stringify({
        id: "OBJ-CAP-2",
        statement: "Lower case archive",
        generation: 4,
      });

      vfs.writeFileSync(join(capsulesDir, "ARCHIVED_OBJECTIVES.jsonl"), rootJsonl);
      vfs.writeFileSync(join(capDir1, "ARCHIVED_OBJECTIVES.jsonl"), cap1Jsonl);
      vfs.writeFileSync(join(capDir2, "archived_objectives.jsonl"), cap2Jsonl);

      const docs = indexArchivedObjectiveDocuments(capsulesDir);
      expect(docs.length).toBe(3);
      expect(docs.some((d) => d.id === "archived-OBJ-ROOT-1")).toBe(true);
      expect(docs.some((d) => d.id === "archived-OBJ-CAP-1")).toBe(true);
      expect(docs.some((d) => d.id === "archived-OBJ-CAP-2")).toBe(true);
      expect(docs[0]?.kind).toBe("decision");
    });

    it("scans explicitRun JSONL files (both upper and lower case)", () => {
      const explicit = `${baseDir}/explicit-run/mind-gen-7`;
      vfs.mkdirSync(explicit, { recursive: true });
      vfs.writeFileSync(
        join(explicit, "ARCHIVED_OBJECTIVES.jsonl"),
        JSON.stringify({ id: "OBJ-EXP-1", statement: "Explicit upper objective" }),
      );
      vfs.writeFileSync(
        join(explicit, "archived_objectives.jsonl"),
        JSON.stringify({ id: "OBJ-EXP-2", statement: "Explicit lower objective" }),
      );

      const docs = indexArchivedObjectiveDocuments(`${baseDir}/empty-capsules`, explicit);
      expect(docs.length).toBe(2);
      expect(docs.some((d) => d.id === "archived-OBJ-EXP-1")).toBe(true);
      expect(docs.some((d) => d.id === "archived-OBJ-EXP-2")).toBe(true);
    });

    it("handles non-existent paths, blank lines, missing IDs, and corrupted JSONL gracefully", () => {
      const emptyDocs = indexArchivedObjectiveDocuments(`${baseDir}/non-existent`);
      expect(emptyDocs).toEqual([]);

      const corruptedDir = `${capsulesDir}/mind-gen-corrupted`;
      vfs.mkdirSync(corruptedDir, { recursive: true });
      vfs.writeFileSync(
        join(corruptedDir, "ARCHIVED_OBJECTIVES.jsonl"),
        [
          "",
          "   ",
          "{bad-json",
          JSON.stringify({ statement: "missing id line" }),
          JSON.stringify({ id: 12345, statement: "numeric id line" }),
          JSON.stringify({ id: "OBJ-VALID", statement: "Valid record" }),
        ].join("\n"),
      );

      const docs = indexArchivedObjectiveDocuments(capsulesDir);
      expect(docs.some((d) => d.id === "archived-OBJ-VALID")).toBe(true);
      expect(docs.some((d) => d.title.includes("12345"))).toBe(false);
    });
  });

  describe("indexAllMemory", () => {
    it("aggregates and deduplicates all memory documents into integrated index", () => {
      const repoRoot = `${baseDir}/repo`;
      const repoCapsules = `${repoRoot}/olt/capsules`;
      vfs.mkdirSync(repoCapsules, { recursive: true });

      vfs.writeFileSync(
        join(repoCapsules, "ARCHIVED_OBJECTIVES.jsonl"),
        `${JSON.stringify({ id: "OBJ-INTEGRATED-1", statement: "All memory test" })}\n${JSON.stringify({ id: "OBJ-INTEGRATED-1", statement: "Duplicate ID test" })}\n`,
      );

      const index = indexAllMemory({ repoRoot, capsulesDir: repoCapsules });
      expect(index.total_documents).toBeGreaterThanOrEqual(1);
      expect(index.documents.some((d) => d.id === "archived-OBJ-INTEGRATED-1")).toBe(true);
      expect(index.avg_doc_length).toBeGreaterThan(0);
      expect(index.idf.size).toBeGreaterThan(0);
    });
  });

  describe("Formatting & String Helpers", () => {
    it("truncateString and padRight handle length edge cases", () => {
      expect(truncateString("short", 10)).toBe("short");
      expect(truncateString("longer than limit", 8)).toBe("longer …");
      expect(truncateString("hello", 1)).toBe("…");
      expect(truncateString("hello", 0)).toBe("hell…");
      expect(truncateString("", 5)).toBe("");
      expect(padRight("pad", 6)).toBe("pad   ");
      expect(padRight("exact", 5)).toBe("exact");
      expect(padRight("overflowing", 5)).toBe("overflowing");
    });

    it("renderAsciiMemoryTable formats empty state and populated tables", () => {
      expect(renderAsciiMemoryTable([])).toContain("No memory records discovered");

      const mockResult: MemoryQueryResult = {
        id: "doc-1",
        kind: "charter",
        title: "Test Title",
        capsule_id: "cap-1",
        generation: 1,
        tags: ["tag1"],
        source_path: "path/to/doc",
        score: 4.567,
        snippet: "Short snippet content",
        matched_terms: ["term1"],
        metadata: {},
      };

      const table = renderAsciiMemoryTable([mockResult]);
      expect(table).toContain("Memory ID");
      expect(table).toContain("doc-1");
      expect(table).toContain("4.567");
    });

    it("formatMemoryQueryBrief renders full report with filters and options", () => {
      const mockResult: MemoryQueryResult = {
        id: "doc-brief-1",
        kind: "defect",
        title: "Memory Leak Brief",
        capsule_id: "mind-gen-2",
        generation: 2,
        tags: ["defect", "leak"],
        source_path: "olt/defects.jsonl",
        score: 3.123,
        snippet: "Leak identified in heap.",
        matched_terms: ["leak"],
        metadata: {},
      };

      const brief = formatMemoryQueryBrief({
        query: "leak",
        results: [mockResult],
        totalIndexed: 10,
        capsulesDir,
        runRoot: `${baseDir}/run`,
        kindFilter: "defect",
        generationFilter: 2,
        tagsFilter: "leak",
        patternFilter: "heap",
        isAll: true,
      });

      expect(brief).toContain("### Semantic Knowledge & Memory Search Report");
      expect(brief).toContain("- **Search Query**: `leak`");
      expect(brief).toContain("- **Total Memory Documents Indexed**: 10");
      expect(brief).toContain("#### Match Forensics & Context");
      expect(brief).toContain("- **`doc-brief-1`** [`defect`] [Gen 2] (Score: `3.123`)");

      const briefEmpty = formatMemoryQueryBrief({
        query: "",
        results: [],
        totalIndexed: 0,
        capsulesDir,
        runRoot: null,
      });
      expect(briefEmpty).toContain("- **Search Query**: `*all*`");
      expect(briefEmpty).toContain("- **Target Run Root**: *all*");
      expect(briefEmpty).toContain("No memory records discovered matching query");
    });
  });
});
