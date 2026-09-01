/**
 * Unit Test Suite for Core Memory Entrypoint, Charter/Defect/Capsule Indexers, and Tokenizer Types.
 * Covers indexCharterDocuments, indexDefectDocuments, indexCapsuleDocuments,
 * normalizeTags, createMemoryDocument, buildMemoryIndex, tokenize, isRecord, and extractGeneration.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs";
import { normalize } from "node:path";
import {
  MEMORY_KINDS,
  buildMemoryIndex,
  compileSearchPattern,
  countTokens,
  createMemoryDocument,
  extractGeneration,
  extractGenerationFromCapsuleId,
  indexCapsuleDocuments,
  indexCharterDocuments,
  indexDefectDocuments,
  isRecord,
  normalizeTags,
  tokenize,
} from "../../../../olt/scripts/src/mind/memory/core/index.ts";

describe("Core Memory Entrypoint & Indexers (entry.ts)", () => {
  const virtualFiles = new Map<string, string>();
  const virtualDirs = new Set<string>();

  let existsSpy: ReturnType<typeof spyOn>;
  let readFileSyncSpy: ReturnType<typeof spyOn>;
  let readdirSpy: ReturnType<typeof spyOn>;
  let lstatSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    virtualFiles.clear();
    virtualDirs.clear();

    existsSpy = spyOn(fs, "existsSync").mockImplementation((p) => {
      const s = normalize(String(p));
      return virtualFiles.has(s) || virtualDirs.has(s);
    });

    lstatSpy = spyOn(fs, "lstatSync").mockImplementation((p) => {
      const s = normalize(String(p));
      const isF = virtualFiles.has(s);
      const isD = virtualDirs.has(s);
      if (!isF && !isD) throw new Error(`ENOENT: ${s}`);
      return {
        isFile: () => isF,
        isDirectory: () => isD,
        isSymbolicLink: () => false,
      } as unknown as fs.Stats;
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
    lstatSpy.mockRestore();
    readFileSyncSpy.mockRestore();
    readdirSpy.mockRestore();
  });

  describe("indexCharterDocuments and indexDefectDocuments", () => {
    it("indexes charter directives and references without physical disk writes", () => {
      const repoRoot = normalize("/virtual/repo");
      const refDir = normalize(`${repoRoot}/olt/references`);
      virtualDirs.add(repoRoot);
      virtualDirs.add(normalize(`${repoRoot}/olt`));
      virtualDirs.add(normalize(`${repoRoot}/olt/agents`));
      virtualDirs.add(refDir);

      virtualFiles.set(
        normalize(`${repoRoot}/olt/agents/mind.yaml`),
        "identity: mind\ngoals:\n  - id: G1\n    statement: Autonomous Governance\nnon_goals:\n  - Manual intervention\ndirectives:\n  - Invariant 1",
      );
      virtualFiles.set(
        normalize(`${refDir}/architecture.md`),
        "# Architecture Overview\nSystem description.",
      );

      const docs = indexCharterDocuments(repoRoot);
      expect(docs.length).toBe(3);
      expect(docs.find((d) => d.id === "charter-root")?.kind).toBe("charter");
      expect(docs.find((d) => d.id === "charter-goal-g1")?.title).toBe("Charter Goal G1");
      expect(docs.find((d) => d.id === "reference-architecture")?.tags).toContain("architecture");
    });

    it("indexes defects from root, capsules, and explicit runs", () => {
      const capsulesDir = normalize("/virtual/capsules");
      const capDir = normalize(`${capsulesDir}/mind-gen-6`);
      const explicit = normalize("/virtual/explicit/run-gen-9");
      virtualDirs.add(capsulesDir);
      virtualDirs.add(capDir);
      virtualDirs.add(explicit);

      virtualFiles.set(
        normalize(`${capsulesDir}/defects.jsonl`),
        JSON.stringify({ id: "DEF-ROOT", type: "root_bug", observation: "Root issue" }),
      );
      virtualFiles.set(
        normalize(`${capDir}/defects.jsonl`),
        JSON.stringify({
          id: "DEF-100",
          type: "type_error",
          observation: "Missing property",
          remediation: "Add default",
          severity: "high",
          status: "open",
          category: "runtime",
          pid: 1234,
          agent_id: "agent-01",
        }),
      );
      virtualFiles.set(
        normalize(`${explicit}/defects.jsonl`),
        JSON.stringify({ id: "DEF-EXP", type: "explicit_defect", observation: "Exp issue" }),
      );

      const docs = indexDefectDocuments(capsulesDir, explicit);
      expect(docs.length).toBe(3);
      expect(docs.some((d) => d.id === "defect-DEF-ROOT")).toBe(true);
      expect(docs.some((d) => d.id === "defect-DEF-100")).toBe(true);
      expect(docs.some((d) => d.id === "defect-DEF-EXP")).toBe(true);
    });
  });

  describe("indexCapsuleDocuments", () => {
    it("indexes prompt, trace, and task artifacts from capsules and explicitRun", () => {
      const capsulesDir = normalize("/virtual/capsules");
      const capDir = normalize(`${capsulesDir}/mind-gen-8`);
      const explicit = normalize("/virtual/explicit/cap-gen-9");
      virtualDirs.add(capsulesDir);
      virtualDirs.add(capDir);
      virtualDirs.add(explicit);

      virtualFiles.set(normalize(`${capDir}/prompt.md`), "System prompt instructions.");
      virtualFiles.set(normalize(`${capDir}/trace.md`), "Execution trace logs.");
      virtualFiles.set(
        normalize(`${capDir}/state.json`),
        JSON.stringify({
          tasks: [
            { id: "task-boot", label: "Bootstrap", status: "completed", write_scope: ["src/"] },
          ],
        }),
      );
      virtualFiles.set(normalize(`${explicit}/prompt.md`), "Explicit prompt instructions.");

      const docs = indexCapsuleDocuments(capsulesDir, explicit);
      expect(docs.length).toBe(4);
      expect(docs.some((d) => d.id === "prompt-mind-gen-8")).toBe(true);
      expect(docs.some((d) => d.id === "prompt-cap-gen-9")).toBe(true);
    });
  });

  describe("Storage, Tokenizer, and Types", () => {
    it("normalizes tags into lowercase unique arrays", () => {
      expect(normalizeTags(["Tag1", "tag2", "TAG1 ", "   "])).toEqual(["tag1", "tag2"]);
      expect(normalizeTags("alpha, beta; gamma delta")).toEqual([
        "alpha",
        "beta",
        "gamma",
        "delta",
      ]);
      expect(normalizeTags(undefined)).toEqual([]);
    });

    it("tokenizes text filtering stop words and extracts generations", () => {
      const tokens = tokenize("The quick-brown fox_jumps in and out of 123 dogs!");
      expect(tokens).toContain("quick");
      expect(tokens).not.toContain("the");

      expect(countTokens(["a", "b", "a"])).toEqual({ a: 2, b: 1 });
      expect(MEMORY_KINDS).toEqual(["capsule", "defect", "decision", "charter", "report"]);
      expect(isRecord({ key: "value" })).toBe(true);
      expect(isRecord(null)).toBe(false);

      expect(extractGenerationFromCapsuleId("mind-gen-12")).toBe(12);
      expect(extractGenerationFromCapsuleId("run_generation_4")).toBe(4);
      expect(extractGenerationFromCapsuleId("invalid-cap")).toBeNull();

      expect(extractGeneration({ generation: 5 })).toBe(5);
      expect(extractGeneration({ generation: "7" })).toBe(7);
      expect(extractGeneration({ generation_id: 8 })).toBe(8);
      expect(extractGeneration({ generation_id: "gen-9" })).toBe(9);
      expect(extractGeneration({ generation_id: "invalid-string" })).toBeNull();
      expect(extractGeneration({ metadata: { generation: 11 } })).toBe(11);
      expect(extractGeneration({ capsule: "capsule-generation-13" })).toBe(13);
      expect(extractGeneration({}, "fallback-gen-15")).toBe(15);
      expect(extractGeneration({})).toBeNull();
    });

    it("creates memory documents, indexes them, and compiles search patterns", () => {
      const doc = createMemoryDocument({
        id: "doc-sample",
        kind: "decision",
        title: "Sample Decision",
        capsule_id: "mind-gen-1",
        source_path: "path.md",
        content: "A short sample document.",
      });
      expect(doc.generation).toBe(1);

      const index = buildMemoryIndex([doc]);
      expect(index.total_documents).toBe(1);
      expect(index.idf.has("sample")).toBe(true);

      const badRegex = compileSearchPattern("/invalid(regex/i");
      expect(badRegex?.test("/invalid(regex/i")).toBe(true);
    });
  });
});
