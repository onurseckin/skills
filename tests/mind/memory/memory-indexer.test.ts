import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { join, resolve } from "node:path";
import { VirtualMemoryFS } from "../../../olt/scripts/src/testing/virtual-fs/memory-fs.ts";
import {
  createVirtualFSSession,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/spies.ts";
import { indexCharterDocuments } from "../../../olt/scripts/src/mind/memory/core/indexer.ts";

describe("Memory Indexer Coverage Suite (VirtualMemoryFS)", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    session.cleanup();
  });

  describe("indexCharterDocuments", () => {
    it("indexes valid charter manifest and extracts root document plus goals", () => {
      const repoRoot = "/virtual/repo/mind-workspace";
      const charterPath = resolve(repoRoot, "olt/agents/mind.yaml");

      const charterYaml = `
identity: Mind Core Agent
goals:
  - id: G1
    statement: Maintain systemic integrity and soundness
  - id: G2
    statement: Protect SSD longevity through pure in-memory testing
non_goals:
  - Do not write to physical SSD during tests
`;

      vfs.mkdirSync(resolve(repoRoot, "olt/scripts"), { recursive: true });
      vfs.writeFileSync(resolve(repoRoot, "olt/scripts/harness.ts"), "");
      vfs.mkdirSync(resolve(repoRoot, "olt/agents"), { recursive: true });
      vfs.writeFileSync(charterPath, charterYaml);

      const docs = indexCharterDocuments(repoRoot);
      expect(docs.length).toBe(3);

      const rootDoc = docs.find((d) => d.id === "charter-root");
      expect(rootDoc).toBeDefined();
      expect(rootDoc?.kind).toBe("charter");
      expect(rootDoc?.title).toContain("Mind Charter");
      expect(rootDoc?.tags).toContain("directive");
      expect(rootDoc?.snippet).toContain("identity: Mind Core Agent");

      const g1Doc = docs.find((d) => d.id === "charter-goal-g1");
      expect(g1Doc).toBeDefined();
      expect(g1Doc?.title).toBe("Charter Goal G1");
      expect(g1Doc?.snippet).toContain("Maintain systemic integrity");

      const g2Doc = docs.find((d) => d.id === "charter-goal-g2");
      expect(g2Doc).toBeDefined();
      expect(g2Doc?.title).toBe("Charter Goal G2");
      expect(g2Doc?.snippet).toContain("Protect SSD longevity");
    });

    it("handles charter parsing errors non-fatally and proceeds", () => {
      const repoRoot = "/virtual/repo/workspace-malformed";
      const charterPath = resolve(repoRoot, "olt/agents/mind.yaml");

      vfs.mkdirSync(resolve(repoRoot, "olt/scripts"), { recursive: true });
      vfs.writeFileSync(resolve(repoRoot, "olt/scripts/harness.ts"), "");
      vfs.mkdirSync(resolve(repoRoot, "olt/agents"), { recursive: true });
      vfs.writeFileSync(charterPath, "invalid: [yaml: broken syntax {{}}");

      const docs = indexCharterDocuments(repoRoot);
      expect(docs.length).toBe(0);
    });

    it("never indexes a consumer repo's unhidden olt/agents/mind.yaml charter", () => {
      const repoRoot = "/virtual/repo/workspace-consumer-charter";
      const charterPath = resolve(repoRoot, "olt/agents/mind.yaml");

      vfs.mkdirSync(resolve(repoRoot, "olt/agents"), { recursive: true });
      vfs.writeFileSync(
        charterPath,
        "identity: Should Not Be Indexed\ngoals:\n  - id: G1\n    statement: leak\n",
      );

      const docs = indexCharterDocuments(repoRoot);
      expect(docs.some((doc) => doc.id === "charter-root")).toBe(false);
    });

    it("indexes knowledge reference artifacts from .olt/references (.md and .json)", () => {
      const repoRoot = "/virtual/repo/workspace-refs";
      const refDir = resolve(repoRoot, ".olt/references");
      vfs.mkdirSync(refDir, { recursive: true });

      vfs.writeFileSync(
        join(refDir, "architecture.md"),
        "# System Architecture\nZero disk unit testing in-memory.",
      );
      vfs.writeFileSync(
        join(refDir, "schemas.json"),
        JSON.stringify({ schemaVersion: "2.0.0", invariants: ["zero_disk"] }),
      );
      vfs.writeFileSync(join(refDir, "ignored.txt"), "This should be ignored");
      vfs.mkdirSync(join(refDir, "nested-folder"), { recursive: true });

      const docs = indexCharterDocuments(repoRoot);
      expect(docs.length).toBe(2);

      const archDoc = docs.find((d) => d.id === "reference-architecture");
      expect(archDoc).toBeDefined();
      expect(archDoc?.kind).toBe("charter");
      expect(archDoc?.title).toBe("Reference: architecture.md");
      expect(archDoc?.tags).toContain("reference");
      expect(archDoc?.tags).toContain("architecture");
      expect(archDoc?.snippet).toContain("Zero disk");

      const schemaDoc = docs.find((d) => d.id === "reference-schemas");
      expect(schemaDoc).toBeDefined();
      expect(schemaDoc?.title).toBe("Reference: schemas.json");
    });

    it("falls back to olt/references when .olt/references does not exist in the skill-home repo", () => {
      const repoRoot = "/virtual/repo/workspace-fallback-refs";
      vfs.mkdirSync(resolve(repoRoot, "olt/scripts"), { recursive: true });
      vfs.writeFileSync(resolve(repoRoot, "olt/scripts/harness.ts"), "");
      const fallbackDir = resolve(repoRoot, "olt/references");
      vfs.mkdirSync(fallbackDir, { recursive: true });

      vfs.writeFileSync(join(fallbackDir, "guide.md"), "# Fallback Guide\nDetails here.");

      const docs = indexCharterDocuments(repoRoot);
      expect(docs.length).toBe(1);
      expect(docs[0]?.id).toBe("reference-guide");
      expect(docs[0]?.snippet).toContain("Fallback Guide");
    });

    it("never falls back to a consumer repo's unhidden olt/references directory", () => {
      const repoRoot = "/virtual/repo/workspace-consumer-refs";
      const fallbackDir = resolve(repoRoot, "olt/references");
      vfs.mkdirSync(fallbackDir, { recursive: true });

      vfs.writeFileSync(join(fallbackDir, "guide.md"), "# Fallback Guide\nDetails here.");

      const docs = indexCharterDocuments(repoRoot);
      expect(docs.some((doc) => doc.id === "reference-guide")).toBe(false);
    });

    it("handles missing charter and references directories gracefully", () => {
      const repoRoot = "/virtual/repo/workspace-empty";
      const docs = indexCharterDocuments(repoRoot);
      expect(docs).toEqual([]);
    });

    it("handles non-fatal error when reading a single corrupt reference file", () => {
      const repoRoot = "/virtual/repo/workspace-error";
      const refDir = resolve(repoRoot, ".olt/references");
      vfs.mkdirSync(refDir, { recursive: true });

      vfs.writeFileSync(join(refDir, "good.md"), "Good content");
      vfs.writeFileSync(join(refDir, "bad.md"), "Bad content");

      const origReadFile = session.vfs.readFileSync.bind(session.vfs);
      spyOn(session.vfs, "readFileSync").mockImplementation(
        (p: string, opts?: Parameters<typeof origReadFile>[1]) => {
          if (p.includes("bad.md")) {
            throw new Error("Simulated I/O read failure");
          }
          return origReadFile(p, opts);
        },
      );

      const docs = indexCharterDocuments(repoRoot);
      expect(docs.length).toBe(1);
      expect(docs[0]?.id).toBe("reference-good");
    });
  });
});
