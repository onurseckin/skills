/**
 * @file lifecycle-and-resolution.test.ts
 * Unit tests for Defect Lifecycle, Resolution Transitions, and Audit Reporting
 */

import { describe, expect, it } from "bun:test";
import {
  auditDefectLog,
  formatDefectAuditBrief,
  formulateDefectCandidates,
  resolveDefect,
  type DefectEntry,
} from "../../../../olt/scripts/src/mind/defects/index.ts";
import { createMockDefectEntry, createMockResolutionProof } from "./defect-fixture.ts";

describe("Defect Lifecycle & Resolution Suite", () => {
  describe("resolveDefect", () => {
    it("transitions an open defect to resolved with valid resolution proof", () => {
      const openDefect = createMockDefectEntry({ id: "def-resolve-1", status: "open" });
      const proof = createMockResolutionProof();

      const resolved = resolveDefect(openDefect, proof);
      expect(resolved.status).toBe("resolved");
      expect(resolved.resolvedAt).toBeDefined();
      expect(resolved.proof).toEqual(proof);
    });

    it("rejects resolution attempt when proof is missing or invalid", () => {
      const openDefect = createMockDefectEntry({ id: "def-resolve-2", status: "open" });
      const invalidProof = createMockResolutionProof({ testPath: "" });

      expect(() => resolveDefect(openDefect, invalidProof)).toThrow();
    });

    it("is idempotent when resolving an already resolved defect with updated proof", () => {
      const openDefect = createMockDefectEntry({ id: "def-resolve-3", status: "open" });
      const proof1 = createMockResolutionProof({ verificationHash: "hash-1" });
      const resolvedFirst = resolveDefect(openDefect, proof1);

      const proof2 = createMockResolutionProof({ verificationHash: "hash-2" });
      const resolvedSecond = resolveDefect(resolvedFirst, proof2);

      expect(resolvedSecond.status).toBe("resolved");
      expect(resolvedSecond.proof?.verificationHash).toBe("hash-2");
    });
  });

  describe("auditDefectLog", () => {
    it("computes accurate audit summaries across mixed status entries", () => {
      const entries: DefectEntry[] = [
        createMockDefectEntry({ id: "d1", status: "open", severity: "P0" }),
        createMockDefectEntry({ id: "d2", status: "open", severity: "P1" }),
        createMockDefectEntry({ id: "d3", status: "in_progress", severity: "P2" }),
        createMockDefectEntry({
          id: "d4",
          status: "resolved",
          severity: "P1",
          proof: createMockResolutionProof(),
        }),
        createMockDefectEntry({ id: "d5", status: "wontfix", severity: "P3" }),
      ];

      const report = auditDefectLog(entries);
      expect(report.totalCount).toBe(5);
      expect(report.openCount).toBe(2);
      expect(report.inProgressCount).toBe(1);
      expect(report.resolvedCount).toBe(1);
      expect(report.criticalOpenCount).toBe(1);
      expect(report.resolutionRate).toBeCloseTo(0.2, 2);
    });

    it("reports healthy metrics on an empty log", () => {
      const report = auditDefectLog([]);
      expect(report.totalCount).toBe(0);
      expect(report.openCount).toBe(0);
      expect(report.criticalOpenCount).toBe(0);
      expect(report.resolutionRate).toBe(1);
    });
  });

  describe("formulateDefectCandidates", () => {
    it("prioritizes P0 and P1 open defects for candidate promotion", () => {
      const entries: DefectEntry[] = [
        createMockDefectEntry({ id: "def-p0", severity: "P0", status: "open" }),
        createMockDefectEntry({ id: "def-p3", severity: "P3", status: "open" }),
        createMockDefectEntry({ id: "def-p1", severity: "P1", status: "open" }),
        createMockDefectEntry({ id: "def-res", severity: "P0", status: "resolved" }),
      ];

      const candidates = formulateDefectCandidates(entries);
      expect(candidates.length).toBe(2);
      expect(candidates[0]?.id).toBe("def-p0");
      expect(candidates[1]?.id).toBe("def-p1");
    });
  });

  describe("formatDefectAuditBrief", () => {
    it("generates concise, structured human-readable audit diagnostics", () => {
      const entries: DefectEntry[] = [
        createMockDefectEntry({ id: "def-brief-1", severity: "P0", status: "open" }),
      ];

      const report = auditDefectLog(entries);
      const brief = formatDefectAuditBrief(report);
      expect(brief).toContain("Defect Audit Summary");
      expect(brief).toContain("Total: 1");
      expect(brief).toContain("Open: 1");
    });
  });
});
