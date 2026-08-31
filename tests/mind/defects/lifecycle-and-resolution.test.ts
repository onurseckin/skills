/**
 * @file lifecycle-and-resolution.test.ts
 * Unit tests for Defect Lifecycle, Resolution Transitions, and Audit Reporting
 */

import { describe, expect, it } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  auditDefectLog,
  formatDefectAuditBrief,
  formulateDefectCandidates,
  resolveDefect,
  type DefectEntry,
} from "../../../olt/scripts/src/mind/defects/index.ts";
import { createMockDefectEntry, createMockResolutionProof } from "./defect-fixture.ts";

describe("Defect Lifecycle & Resolution Suite", () => {
  describe("resolveDefect", () => {
    it("transitions an open defect to resolved with valid resolution proof", () => {
      const openDefect = createMockDefectEntry({ id: "def-resolve-1", status: "open" });
      const proof = createMockResolutionProof();

      const resolved = resolveDefect(openDefect, proof);
      expect(resolved.status).toBe("resolved");
      expect(resolved.resolution?.task_id).toBe(proof.task_id);
      expect(resolved.resolution?.test_assertion).toBe(proof.test_assertion);
      expect(resolved.resolution?.resolved_at).toBe(proof.resolved_at);
      expect(openDefect.status).toBe("open"); // Pure / immutable
    });

    it("rejects resolution attempt when proof is missing or invalid", () => {
      const openDefect = createMockDefectEntry({ id: "def-resolve-2", status: "open" });
      const invalidProof = createMockResolutionProof({ task_id: "" });

      expect(() => resolveDefect(openDefect, invalidProof)).toThrow(HarnessError);
    });

    it("is idempotent and updates resolution proof on re-resolution", () => {
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
    it("handles empty capsule roots array", () => {
      const report = auditDefectLog([]);
      expect(report.total_defects).toBe(0);
      expect(report.open_count).toBe(0);
      expect(report.resolved_count).toBe(0);
      expect(report.wontfix_count).toBe(0);
    });
  });

  describe("formulateDefectCandidates", () => {
    it("generates candidates only for open defects", () => {
      const entries: DefectEntry[] = [
        createMockDefectEntry({ id: "def-p0", severity: "critical", status: "open" }),
        createMockDefectEntry({ id: "def-res", severity: "high", status: "resolved" }),
        createMockDefectEntry({ id: "def-p1", severity: "high", status: "open" }),
      ];

      const candidates = formulateDefectCandidates(entries, ["Goal 1"]);
      expect(candidates.length).toBe(2);
      expect(candidates[0]?.id).toBe("cand-defect-def-p0");
      expect(candidates[1]?.id).toBe("cand-defect-def-p1");
    });

    it("returns empty array when no defects provided", () => {
      expect(formulateDefectCandidates([], ["G1"])).toEqual([]);
    });
  });

  describe("formatDefectAuditBrief", () => {
    it("generates concise, structured human-readable audit diagnostics", () => {
      const report = auditDefectLog([]);
      const brief = formatDefectAuditBrief(report);
      expect(brief).toContain("Defect Audit & Remediation Brief");
      expect(brief).toContain("Total Defects");
    });
  });
});
