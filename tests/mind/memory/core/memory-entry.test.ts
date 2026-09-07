import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
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
import { VirtualMemoryFS } from "../../../../olt/scripts/src/testing/virtual-fs/memory-fs.ts";
import { createVirtualFSSession } from "../../../../olt/scripts/src/testing/virtual-fs/spies.ts";

describe("Core Memory Entrypoint & Indexers (entry.ts)", () => {
  let vfs: VirtualMemoryFS;
  let session: ReturnType<typeof createVirtualFSSession>;
  const baseDir = "/virtual/mind-memory/entry";

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
    vfs.mkdirSync(baseDir, { recursive: true });
  });

  afterEach(() => {
    session.cleanup();
  });

  describe("indexCharterDocuments and indexDefectDocuments", () => {
    it("indexes charter directives and references without physical disk writes in the skill-home repo", () => {
      const repoRoot = `${baseDir}/repo`;
      const refDir = `${repoRoot}/olt/references`;
      const agentsDir = `${repoRoot}/olt/agents`;
      const skillScriptsDir = `${repoRoot}/olt/scripts`;
      vfs.mkdirSync(refDir, { recursive: true });
      vfs.mkdirSync(agentsDir, { recursive: true });
      vfs.mkdirSync(skillScriptsDir, { recursive: true });
      vfs.writeFileSync(join(skillScriptsDir, "harness.ts"), "");

      vfs.writeFileSync(
        join(agentsDir, "mind.yaml"),
        "identity: mind\ngoals:\n  - id: G1\n    statement: Autonomous Governance\nnon_goals:\n  - Manual intervention\ndirectives:\n  - Invariant 1",
      );
      vfs.writeFileSync(
        join(refDir, "architecture.md"),
        "# Architecture Overview\nSystem description.",
      );

      const docs = indexCharterDocuments(repoRoot);
      expect(docs.length).toBe(3);
      expect(docs.find((d) => d.id === "charter-root")?.kind).toBe("charter");
      expect(docs.find((d) => d.id === "charter-goal-g1")?.title).toBe("Charter Goal G1");
      expect(docs.find((d) => d.id === "reference-architecture")?.tags).toContain("architecture");
    });

    it("indexes defects from root, capsules, and explicit runs", () => {
      const capsulesDir = `${baseDir}/capsules`;
      const capDir = `${capsulesDir}/mind-gen-6`;
      const explicit = `${baseDir}/explicit/run-gen-9`;
      vfs.mkdirSync(capDir, { recursive: true });
      vfs.mkdirSync(explicit, { recursive: true });

      vfs.writeFileSync(
        join(capsulesDir, "defects.jsonl"),
        JSON.stringify({ id: "DEF-ROOT", type: "root_bug", observation: "Root issue" }),
      );
      vfs.writeFileSync(
        join(capDir, "defects.jsonl"),
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
      vfs.writeFileSync(
        join(explicit, "defects.jsonl"),
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
      const capsulesDir = `${baseDir}/capsules`;
      const capDir = `${capsulesDir}/mind-gen-8`;
      const explicit = `${baseDir}/explicit/cap-gen-9`;
      vfs.mkdirSync(capDir, { recursive: true });
      vfs.mkdirSync(explicit, { recursive: true });

      vfs.writeFileSync(join(capDir, "prompt.md"), "System prompt instructions.");
      vfs.writeFileSync(join(capDir, "trace.md"), "Execution trace logs.");
      vfs.writeFileSync(
        join(capDir, "state.json"),
        JSON.stringify({
          tasks: [
            { id: "task-boot", label: "Bootstrap", status: "completed", write_scope: ["src/"] },
          ],
        }),
      );
      vfs.writeFileSync(join(explicit, "prompt.md"), "Explicit prompt instructions.");

      const docs = indexCapsuleDocuments(capsulesDir, explicit);
      expect(docs.length).toBe(4);
      expect(docs.some((d) => d.id === "prompt-mind-gen-8")).toBe(true);
      expect(docs.some((d) => d.id === "trace-mind-gen-8")).toBe(true);
      expect(docs.some((d) => d.id === "task-mind-gen-8-task-boot")).toBe(true);
      expect(docs.some((d) => d.id === "prompt-cap-gen-9")).toBe(true);
    });
  });

  describe("Storage, Tokenizer, and Types", () => {
    it("normalizes tags into lowercase unique arrays and rejects empty tokens", () => {
      expect(normalizeTags(["Tag1", "tag2", "TAG1 ", "   "])).toEqual(["tag1", "tag2"]);
      expect(normalizeTags("alpha, beta; gamma delta")).toEqual([
        "alpha",
        "beta",
        "gamma",
        "delta",
      ]);
      expect(normalizeTags("  ALPHA ,,, BETA;;; ;  GAMMA   alpha  ")).toEqual([
        "alpha",
        "beta",
        "gamma",
      ]);
      expect(normalizeTags(undefined)).toEqual([]);
      expect(normalizeTags("")).toEqual([]);
    });

    it("tokenizes text filtering stop words and extracts generations", () => {
      const tokens = tokenize("The quick-brown fox_jumps in and out of 123 dogs!");
      expect(tokens).toContain("quick");
      expect(tokens).not.toContain("the");

      expect(countTokens(["a", "b", "a"])).toEqual({ a: 2, b: 1 });
      expect(MEMORY_KINDS).toEqual(["capsule", "defect", "decision", "charter", "report"]);
      expect(isRecord({ key: "value" })).toBe(true);
      expect(isRecord(null)).toBe(false);
      expect(isRecord("string")).toBe(false);

      expect(extractGenerationFromCapsuleId("mind-gen-12")).toBe(12);
      expect(extractGenerationFromCapsuleId("run_generation_4")).toBe(4);
      expect(extractGenerationFromCapsuleId("invalid-cap")).toBeNull();

      expect(extractGeneration({})).toBeNull();
      expect(extractGeneration({ generation: "" })).toBeNull();
      expect(extractGeneration({ generation: "no-num" })).toBeNull();
      expect(extractGeneration({ generation: 5 })).toBe(5);
      expect(extractGeneration({ generation: -5 })).toBe(-5);
      expect(extractGeneration({ generation: "7" })).toBe(7);
      expect(extractGeneration({ generation_id: 8 })).toBe(8);
      expect(extractGeneration({ generation_id: "gen-9" })).toBe(9);
      expect(extractGeneration({ generation_id: "no-gen-here" })).toBeNull();
      expect(extractGeneration({ generation_id: "invalid-string" })).toBeNull();
      expect(extractGeneration({ metadata: { generation: 11 } })).toBe(11);
      expect(extractGeneration({ capsule: "capsule-generation-13" })).toBe(13);
      expect(extractGeneration({}, "fallback-gen-15")).toBe(15);
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
