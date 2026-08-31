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
      expect(resolved.resolution).toEqual(proof);
    });

    it("rejects resolution attempt when proof is missing or invalid", () => {
      const openDefect = createMockDefectEntry({ id: "def-resolve-2", status: "open" });
      const invalidProof = createMockResolutionProof({ task_id: "" });

      expect(() => resolveDefect(openDefect, invalidProof)).toThrow();
    });

    it("is idempotent when resolving an already resolved defect with updated proof", () => {
      const openDefect = createMockDefectEntry({ id: "def-resolve-3", status: "open" });
      const proof1 = createMockResolutionProof({ task_id: "task-1" });
      const resolvedFirst = resolveDefect(openDefect, proof1);

      const proof2 = createMockResolutionProof({ task_id: "task-2" });
      const resolvedSecond = resolveDefect(resolvedFirst, proof2);

      expect(resolvedSecond.status).toBe("resolved");
      expect(resolvedSecond.resolution?.task_id).toBe("task-2");
    });
  });

  describe("auditDefectLog", () => {
    it("computes accurate audit summaries across mixed status entries", () => {
      const entries: DefectEntry[] = [
        createMockDefectEntry({ id: "d1", status: "open", severity: "critical" }),
        createMockDefectEntry({ id: "d2", status: "open", severity: "high" }),
        createMockDefectEntry({ id: "d3", status: "in_progress", severity: "medium" }),
        createMockDefectEntry({
          id: "d4",
          status: "resolved",
          severity: "high",
          resolution: createMockResolutionProof(),
        }),
        createMockDefectEntry({ id: "d5", status: "wontfix", severity: "low" }),
      ];

      const report = auditDefectLog(entries);
      expect(report.total_defects).toBe(5);
      expect(report.open_count).toBe(3);
      expect(report.resolved_count).toBe(1);
      expect(report.wontfix_count).toBe(1);
    });

    it("reports healthy metrics on an empty log", () => {
      const report = auditDefectLog([]);
      expect(report.total_defects).toBe(0);
      expect(report.open_count).toBe(0);
      expect(report.resolved_count).toBe(0);
      expect(report.wontfix_count).toBe(0);
    });
  });

  describe("formulateDefectCandidates", () => {
    it("formulates candidate proposals for open defects", () => {
      const entries: DefectEntry[] = [
        createMockDefectEntry({
          id: "def-p0",
          severity: "critical",
          status: "open",
          category: "boundary_violation",
        }),
        createMockDefectEntry({
          id: "def-p1",
          severity: "high",
          status: "open",
          category: "code_defect",
        }),
        createMockDefectEntry({ id: "def-res", severity: "critical", status: "resolved" }),
      ];

      const candidates = formulateDefectCandidates(entries);
      expect(candidates.length).toBe(2);
      expect(candidates[0]?.id).toBe("cand-defect-p0");
      expect(candidates[1]?.id).toBe("cand-defect-p1");
    });
  });

  describe("formatDefectAuditBrief", () => {
    it("generates concise, structured human-readable audit diagnostics", () => {
      const entries: DefectEntry[] = [
        createMockDefectEntry({ id: "def-brief-1", severity: "critical", status: "open" }),
      ];

      const report = auditDefectLog(entries);
      const brief = formatDefectAuditBrief(report);
      expect(brief).toContain("Defect Audit & Remediation Brief");
      expect(brief).toContain("Total Defects");
      expect(brief).toContain("def-brief-1");
    });
  });
});
