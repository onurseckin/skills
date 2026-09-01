/**
 * Unit Test Suite for Archived Objectives, Integrated Memory Indexer, and Report Formatters.
 * Covers indexArchivedObjectiveDocuments, indexAllMemory, truncateString, padRight,
 * renderAsciiMemoryTable, and formatMemoryQueryBrief.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs";
import { normalize } from "node:path";
import {
  formatMemoryQueryBrief,
  indexAllMemory,
  indexArchivedObjectiveDocuments,
  padRight,
  renderAsciiMemoryTable,
  truncateString,
} from "../../../../olt/scripts/src/mind/memory/core/archived.ts";
import type { MemoryQueryResult } from "../../../../olt/scripts/src/mind/memory/core/types.ts";

describe("Archived Objectives and Integrated Indexing (archived.ts)", () => {
  const virtualFiles = new Map<string, string>();
  const virtualDirs = new Set<string>();

  let existsSpy: ReturnType<typeof spyOn>;
  let readFileSyncSpy: ReturnType<typeof spyOn>;
  let readdirSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    virtualFiles.clear();
    virtualDirs.clear();

    existsSpy = spyOn(fs, "existsSync").mockImplementation((p) => {
      const s = normalize(String(p));
      return virtualFiles.has(s) || virtualDirs.has(s);
    });

    readFileSyncSpy = spyOn(fs, "readFileSync").mockImplementation((p) => {
      const s = normalize(String(p));
      const val = virtualFiles.get(s);
      if (val === undefined) throw new Error(`ENOENT: ${s}`);
      return val;
    });

    readdirSpy = spyOn(fs, "readdirSync").mockImplementation((p, options) => {
      const s = normalize(String(p));
      if (!virtualDirs.has(s)) throw new Error(`ENOENT: ${s}`);
      const entryMap = new Map<string, boolean>();

      for (const dirPath of virtualDirs) {
        if (dirPath.startsWith(s) && dirPath !== s) {
          const rel = dirPath.slice(s.length).replace(/^[/\\]+/, "");
          const name = rel.split(/[/\\]/)[0];
          if (name) entryMap.set(name, true);
        }
      }

      for (const filePath of virtualFiles.keys()) {
        if (filePath.startsWith(s) && filePath !== s) {
          const rel = filePath.slice(s.length).replace(/^[/\\]+/, "");
          const parts = rel.split(/[/\\]/);
          const name = parts[0];
          if (name && !entryMap.has(name)) entryMap.set(name, parts.length > 1);
        }
      }

      const entries = Array.from(entryMap.entries()).map(([name, isDir]) => ({
        name,
        isDirectory: () => isDir,
        isFile: () => !isDir,
      }));

      if (
        typeof options === "object" &&
        options !== null &&
        (options as { withFileTypes?: boolean }).withFileTypes
      ) {
        return entries as unknown as fs.Dirent[];
      }
      return entries.map((e) => e.name) as unknown as string[];
    });
  });

  afterEach(() => {
    existsSpy.mockRestore();
    readFileSyncSpy.mockRestore();
    readdirSpy.mockRestore();
  });

  describe("indexArchivedObjectiveDocuments", () => {
    it("indexes archived records from root and capsule JSONL files (both upper and lower)", () => {
      const capsulesDir = normalize("/virtual/capsules");
      const capDir1 = normalize(`${capsulesDir}/mind-gen-3`);
      const capDir2 = normalize(`${capsulesDir}/mind-gen-4`);
      virtualDirs.add(capsulesDir);
      virtualDirs.add(capDir1);
      virtualDirs.add(capDir2);

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

      virtualFiles.set(normalize(`${capsulesDir}/ARCHIVED_OBJECTIVES.jsonl`), rootJsonl);
      virtualFiles.set(normalize(`${capDir1}/ARCHIVED_OBJECTIVES.jsonl`), cap1Jsonl);
      virtualFiles.set(normalize(`${capDir2}/archived_objectives.jsonl`), cap2Jsonl);

      const docs = indexArchivedObjectiveDocuments("/virtual/capsules");
      expect(docs.length).toBe(3);
    });

    it("scans explicitRun JSONL files (both upper and lower case)", () => {
      const explicit = normalize("/virtual/explicit-run/mind-gen-7");
      virtualDirs.add(explicit);
      virtualFiles.set(
        normalize(`${explicit}/ARCHIVED_OBJECTIVES.jsonl`),
        JSON.stringify({ id: "OBJ-EXP-1", statement: "Explicit upper objective" }),
      );
      virtualFiles.set(
        normalize(`${explicit}/archived_objectives.jsonl`),
        JSON.stringify({ id: "OBJ-EXP-2", statement: "Explicit lower objective" }),
      );

      const docs = indexArchivedObjectiveDocuments(
        "/virtual/empty",
        "/virtual/explicit-run/mind-gen-7",
      );
      expect(docs.length).toBe(2);
    });
  });

  describe("indexAllMemory", () => {
    it("aggregates and deduplicates all memory documents into integrated index", () => {
      const repoRoot = normalize("/virtual/repo");
      const capsulesDir = normalize(`${repoRoot}/olt/capsules`);
      virtualDirs.add(repoRoot);
      virtualDirs.add(capsulesDir);

      virtualFiles.set(
        normalize(`${capsulesDir}/ARCHIVED_OBJECTIVES.jsonl`),
        JSON.stringify({ id: "OBJ-INTEGRATED-1", statement: "All memory test" }),
      );

      const index = indexAllMemory({ repoRoot, capsulesDir });
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
      expect(padRight("pad", 6)).toBe("pad   ");
      expect(padRight("exact", 5)).toBe("exact");
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
        capsulesDir: "/virtual/capsules",
        runRoot: "/virtual/run",
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
        capsulesDir: "/virtual/capsules",
        runRoot: null,
      });
      expect(briefEmpty).toContain("- **Search Query**: `*all*`");
      expect(briefEmpty).toContain("- **Target Run Root**: *all*");
    });
  });
});
