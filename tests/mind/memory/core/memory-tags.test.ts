/**
 * Unit Test Suite for Memory Decision and Report Document Indexers.
 * Covers indexDecisionDocuments and indexReportDocuments with 100% in-memory virtual filesystem.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs";
import { normalize } from "node:path";
import {
  indexDecisionDocuments,
  indexReportDocuments,
} from "../../../../olt/scripts/src/mind/memory/core/tags.ts";

describe("Decision and Report Document Indexers (tags.ts)", () => {
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
      const entryMap = new Map<string, boolean>(); // name -> isDirectory

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
          if (name && !entryMap.has(name)) {
            entryMap.set(name, parts.length > 1);
          }
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

  describe("indexDecisionDocuments", () => {
    it("returns empty array when capsules directory does not exist or errors", () => {
      expect(indexDecisionDocuments("/nonexistent/capsules")).toEqual([]);
    });

    it("indexes candidates and audit records from capsule state.json", () => {
      const capDir = normalize("/virtual/capsules/mind-gen-2");
      virtualDirs.add(normalize("/virtual/capsules"));
      virtualDirs.add(capDir);

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

      virtualFiles.set(normalize(`${capDir}/state.json`), stateJson);

      const docs = indexDecisionDocuments("/virtual/capsules");
      expect(docs.length).toBe(4); // 2 candidates + 2 audits

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
      const explicit = normalize("/virtual/explicit/run-gen-5");
      virtualDirs.add(explicit);
      virtualFiles.set(normalize(`${explicit}/state.json`), "{ corrupt-json");

      const docs = indexDecisionDocuments("/virtual/empty-capsules", "/virtual/explicit/run-gen-5");
      expect(docs).toEqual([]);
    });
  });

  describe("indexReportDocuments", () => {
    it("returns empty array when capsules directory does not exist", () => {
      expect(indexReportDocuments("/virtual/nonexistent")).toEqual([]);
    });

    it("indexes reports and packet markdown files across capsules", () => {
      const capDir = normalize("/virtual/capsules/mind-gen-4");
      const reportsDir = normalize(`${capDir}/reports`);
      const packetsDir = normalize(`${capDir}/packets`);
      const packetSubDir = normalize(`${packetsDir}/planner-role`);

      virtualDirs.add(normalize("/virtual/capsules"));
      virtualDirs.add(capDir);
      virtualDirs.add(reportsDir);
      virtualDirs.add(packetsDir);
      virtualDirs.add(packetSubDir);

      virtualFiles.set(
        normalize(`${reportsDir}/summary.md`),
        "# Final Execution Summary\nAll stages completed successfully.",
      );
      virtualFiles.set(
        normalize(`${packetSubDir}/packet.md`),
        "# Planner Packet\nAssigned objectives and invariants.",
      );

      const docs = indexReportDocuments("/virtual/capsules");
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

    it("handles explicitRun for reports indexer", () => {
      const explicit = normalize("/virtual/explicit-run/mind-gen-9");
      const reportsDir = normalize(`${explicit}/reports`);
      virtualDirs.add(explicit);
      virtualDirs.add(reportsDir);
      virtualFiles.set(normalize(`${reportsDir}/perf.txt`), "Performance metrics OK.");

      const docs = indexReportDocuments("/virtual/capsules", "/virtual/explicit-run/mind-gen-9");
      expect(docs.length).toBe(1);
      expect(docs[0]?.capsule_id).toBe("mind-gen-9");
      expect(docs[0]?.generation).toBe(9);
    });
  });
});
