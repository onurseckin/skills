import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  indexDecisionDocuments,
  indexReportDocuments,
} from "../../../../olt/scripts/src/mind/memory/core/tags.ts";
import { VirtualMemoryFS } from "../../../../olt/scripts/src/testing/virtual-fs/memory-fs.ts";
import { createVirtualFSSession } from "../../../../olt/scripts/src/testing/virtual-fs/spies.ts";

describe("Decision and Report Document Indexers (tags.ts)", () => {
  let vfs: VirtualMemoryFS;
  let session: ReturnType<typeof createVirtualFSSession>;
  const baseDir = "/virtual/mind-memory/tags";
  const capsulesDir = `${baseDir}/capsules`;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
    vfs.mkdirSync(capsulesDir, { recursive: true });
  });

  afterEach(() => {
    session.cleanup();
  });

  describe("indexDecisionDocuments", () => {
    it("returns empty array when capsules directory does not exist or errors", () => {
      expect(indexDecisionDocuments(`${baseDir}/nonexistent-capsules`)).toEqual([]);
    });

    it("indexes candidates and audit records from capsule state.json", () => {
      const capDir = `${capsulesDir}/mind-gen-2`;
      vfs.mkdirSync(capDir, { recursive: true });

      const stateJson = JSON.stringify({
        candidates: [
          {
            id: "cand-101",
            statement: "Refactor memory pipeline",
            rationale: "Improves cache locality",
            status: "admitted",
            decided_by: "architect",
          },
          {
            statement: "Fallback candidate with no id",
            status: "declined",
          },
          "invalid-primitive-candidate",
        ],
        audits: [
          {
            id: "audit-202",
            verdict: "passed",
            actor: "watchdog",
          },
          {
            verdict: "failed",
          },
        ],
      });

      vfs.writeFileSync(join(capDir, "state.json"), stateJson);

      const docs = indexDecisionDocuments(capsulesDir);
      expect(docs.length).toBe(4);

      const cand1 = docs.find((d) => d.id === "decision-candidate-cand-101");
      expect(cand1).toMatchObject({
        kind: "decision",
        capsule_id: "mind-gen-2",
        generation: 2,
      });
      expect(cand1?.tags).toContain("admitted");
      expect(cand1?.tags).toContain("gen-2");

      const candFallback = docs.find((d) => d.id === "decision-candidate-cand-1");
      expect(candFallback?.title).toContain("cand-1");

      const audit1 = docs.find((d) => d.id === "decision-audit-audit-202");
      expect(audit1).toMatchObject({
        kind: "decision",
        capsule_id: "mind-gen-2",
        generation: 2,
      });
      expect(audit1?.tags).toContain("passed");

      const auditFallback = docs.find((d) => d.id === "decision-audit-audit-1");
      expect(auditFallback?.title).toContain("audit-1");
    });

    it("handles explicitRun directory and corrupted state.json gracefully", () => {
      const explicit = `${baseDir}/explicit/run-gen-5`;
      vfs.mkdirSync(explicit, { recursive: true });
      vfs.writeFileSync(join(explicit, "state.json"), "{ corrupt-json");

      const docs = indexDecisionDocuments(`${baseDir}/empty-capsules`, explicit);
      expect(docs).toEqual([]);
    });

    it("safely ignores non-array candidate and audit fields in state.json", () => {
      const capDir = `${capsulesDir}/mind-gen-malformed`;
      vfs.mkdirSync(capDir, { recursive: true });
      vfs.writeFileSync(
        join(capDir, "state.json"),
        JSON.stringify({ candidates: "none", audits: null, other: 123 }),
      );

      const docs = indexDecisionDocuments(capsulesDir);
      expect(docs).toEqual([]);
    });
  });

  describe("indexReportDocuments", () => {
    it("returns empty array when capsules directory does not exist", () => {
      expect(indexReportDocuments(`${baseDir}/nonexistent`)).toEqual([]);
    });

    it("indexes reports and packet markdown files across capsules", () => {
      const capDir = `${capsulesDir}/mind-gen-4`;
      const reportsDir = `${capDir}/reports`;
      const packetsDir = `${capDir}/packets`;
      const packetSubDir = `${packetsDir}/planner-role`;

      vfs.mkdirSync(reportsDir, { recursive: true });
      vfs.mkdirSync(packetSubDir, { recursive: true });

      vfs.writeFileSync(
        join(reportsDir, "summary.md"),
        "# Final Execution Summary\nAll stages completed successfully.",
      );
      vfs.writeFileSync(
        join(packetSubDir, "packet.md"),
        "# Planner Packet\nAssigned objectives and invariants.",
      );

      const docs = indexReportDocuments(capsulesDir);
      expect(docs.length).toBe(2);

      const reportDoc = docs.find((d) => d.id === "report-mind-gen-4-summary");
      expect(reportDoc).toMatchObject({
        kind: "report",
        capsule_id: "mind-gen-4",
        generation: 4,
      });
      expect(reportDoc?.snippet).toContain("Final Execution Summary");
      expect(reportDoc?.tags).toContain("summary");

      const packetDoc = docs.find((d) => d.id === "packet-mind-gen-4-planner-role");
      expect(packetDoc).toMatchObject({
        kind: "report",
        capsule_id: "mind-gen-4",
        generation: 4,
      });
      expect(packetDoc?.snippet).toContain("Planner Packet");
      expect(packetDoc?.tags).toContain("planner-role");
    });

    it("handles explicitRun for reports indexer and ignores directory entries in reports", () => {
      const explicit = `${baseDir}/explicit-run/mind-gen-9`;
      const reportsDir = `${explicit}/reports`;
      const nestedSubDir = `${reportsDir}/sub-directory`;
      vfs.mkdirSync(nestedSubDir, { recursive: true });
      vfs.writeFileSync(join(reportsDir, "perf.txt"), "Performance metrics OK.");

      const docs = indexReportDocuments(capsulesDir, explicit);
      expect(docs.length).toBe(1);
      expect(docs[0]?.capsule_id).toBe("mind-gen-9");
      expect(docs[0]?.generation).toBe(9);
    });
  });
});
