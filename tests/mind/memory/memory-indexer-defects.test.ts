import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { VirtualMemoryFS } from "../../../olt/scripts/src/testing/virtual-fs/memory-fs.ts";
import {
  createVirtualFSSession,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/spies.ts";
import { indexDefectDocuments } from "../../../olt/scripts/src/mind/memory/core/indexer.ts";

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

  describe("indexDefectDocuments", () => {
    it("indexes defects from root defects.jsonl, per-capsule directories, and explicitRun", () => {
      const capsulesDir = "/virtual/capsules/main-capsules";
      const cap1Dir = join(capsulesDir, "mind-gen-5");
      const explicitRunDir = "/virtual/capsules/explicit-run/mind-gen-9";

      vfs.mkdirSync(capsulesDir, { recursive: true });
      vfs.mkdirSync(cap1Dir, { recursive: true });
      vfs.mkdirSync(explicitRunDir, { recursive: true });
      vfs.writeFileSync(join(capsulesDir, "stray-readme.txt"), "Not a capsule directory");

      const rootDefect = JSON.stringify({
        id: "DEF-ROOT-1",
        type: "flaky_test",
        category: "test_flakiness",
        status: "open",
        severity: "critical",
        observation: "Test timed out on APFS lock",
        remediation: "Migrate to VirtualMemoryFS in-memory mocking",
        tags: ["apfs", "kernel"],
        pid: 1234,
        ppid: 1,
        agent_id: "agent-01",
      });

      const capDefect = JSON.stringify({
        id: "DEF-CAP-1",
        type: "memory_leak",
        category: "resource_exhaustion",
        status: "resolved",
        severity: "high",
        observation: "Leaking file descriptors",
        remediation: "Close descriptors deterministically",
        labels: ["leak", "fd"],
        generation: 5,
      });

      const explicitDefect = JSON.stringify({
        id: "DEF-EXP-1",
        type: "race_condition",
        observation: "Two workers concurrently accessing sqlite journal",
        remediation: "Use in-memory lock table",
      });

      vfs.writeFileSync(join(capsulesDir, "defects.jsonl"), rootDefect);
      vfs.writeFileSync(join(cap1Dir, "defects.jsonl"), capDefect);
      vfs.writeFileSync(join(explicitRunDir, "defects.jsonl"), explicitDefect);

      const docs = indexDefectDocuments(capsulesDir, explicitRunDir);
      expect(docs.length).toBe(3);

      const rootDoc = docs.find((d) => d.id === "defect-DEF-ROOT-1");
      expect(rootDoc).toBeDefined();
      expect(rootDoc?.kind).toBe("defect");
      expect(rootDoc?.title).toBe("Defect [DEF-ROOT-1]: flaky_test");
      expect(rootDoc?.capsule_id).toBeNull();
      expect(rootDoc?.tags).toContain("critical");
      expect(rootDoc?.tags).toContain("apfs");
      expect(rootDoc?.snippet).toContain("[CRITICAL | open]");
      expect(rootDoc?.metadata?.pid).toBe(1234);
      expect(rootDoc?.metadata?.agent_id).toBe("agent-01");

      const capDoc = docs.find((d) => d.id === "defect-DEF-CAP-1");
      expect(capDoc).toBeDefined();
      expect(capDoc?.capsule_id).toBe("mind-gen-5");
      expect(capDoc?.generation).toBe(5);
      expect(capDoc?.tags).toContain("gen-5");
      expect(capDoc?.tags).toContain("leak");

      const expDoc = docs.find((d) => d.id === "defect-DEF-EXP-1");
      expect(expDoc).toBeDefined();
      expect(expDoc?.capsule_id).toBe("mind-gen-9");
      expect(expDoc?.generation).toBe(9);
      expect(expDoc?.tags).toContain("warning");
      expect(expDoc?.tags).toContain("code_defect");
    });

    it("gracefully handles missing capsulesDir, empty lines, and malformed JSON entries", () => {
      const emptyCapsules = "/virtual/capsules/nonexistent";
      expect(indexDefectDocuments(emptyCapsules)).toEqual([]);

      const capsulesDir = "/virtual/capsules/corrupt";
      vfs.mkdirSync(capsulesDir, { recursive: true });

      const content = [
        "",
        "   ",
        "{ invalid json",
        JSON.stringify({ not_a_defect: true }),
        JSON.stringify({ id: "DEF-OK-1", type: "type_error", observation: "Correct defect" }),
        "another bad line",
      ].join("\n");

      vfs.writeFileSync(join(capsulesDir, "defects.jsonl"), content);

      const docs = indexDefectDocuments(capsulesDir);
      expect(docs.length).toBe(1);
      expect(docs[0]?.id).toBe("defect-DEF-OK-1");
      expect(docs[0]?.snippet).toContain("Correct defect");
    });

    it("handles defects with missing optional fields, non-array tags, and non-numeric process IDs", () => {
      const capsulesDir = "/virtual/capsules/boundary-capsules";
      vfs.mkdirSync(capsulesDir, { recursive: true });

      const defectLine = JSON.stringify({
        id: "DEF-MIN-1",
        type: "syntax_error",
        tags: "invalid-string-tag",
        pid: "not-a-number",
        ppid: null,
      });

      vfs.writeFileSync(join(capsulesDir, "defects.jsonl"), defectLine);

      const docs = indexDefectDocuments(capsulesDir);
      expect(docs.length).toBe(1);
      const doc = docs[0]!;
      expect(doc.id).toBe("defect-DEF-MIN-1");
      expect(doc.tags).toContain("defect");
      expect(doc.tags).toContain("warning");
      expect(doc.tags).toContain("open");
      expect(doc.tags).toContain("code_defect");
      expect(doc.tags).toContain("syntax_error");
      expect(doc.snippet).toContain("[WARNING | open]");
      expect(doc.metadata.pid).toBeUndefined();
      expect(doc.metadata.ppid).toBeUndefined();
      expect(doc.metadata.agent_id).toBeUndefined();
    });
  });
});
