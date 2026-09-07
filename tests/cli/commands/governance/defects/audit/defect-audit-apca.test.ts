import { describe, expect, it } from "bun:test";
import {
  calculateApcaLightnessContrast,
  formatDefectAuditReport,
  getApcaBadgeInfo,
  renderApcaContrastBadge,
  renderAsciiDefectTable,
  type AuditedDefect,
  type DefectAuditSummary,
} from "../../../../../../olt/scripts/src/cli/commands/defect-audit.ts";

function createDefect(id: string, overrides: Partial<AuditedDefect> = {}): AuditedDefect {
  return {
    id,
    type: "code_defect",
    severity: "critical",
    timestamp: "2026-08-30T12:00:00.000Z",
    pid: 1234,
    ppid: 1,
    agent_id: "agent-1",
    observation: "Obs for " + id,
    remediation: "Fix for " + id,
    context: { category: "core_engine" },
    status: "open",
    source_capsule: "capsule-1",
    source_file: "/virtual/defects.jsonl",
    ...overrides,
  };
}

describe("defect-audit apca contrast and formatting suite", () => {
  describe("calculateApcaLightnessContrast & APCA Badges", () => {
    it("computes APCA contrast correctly across dark/light and threshold boundaries", () => {
      const white = { r: 255, g: 255, b: 255 };
      const black = { r: 0, g: 0, b: 0 };
      const gray = { r: 128, g: 128, b: 128 };
      const darkRed = { r: 183, g: 28, b: 28 };

      expect(calculateApcaLightnessContrast(white, black)).toBeGreaterThan(60);
      expect(calculateApcaLightnessContrast(black, white)).toBeGreaterThan(60);
      expect(calculateApcaLightnessContrast(gray, gray)).toBe(0);
      expect(calculateApcaLightnessContrast({ r: 10, g: 10, b: 10 }, { r: 10, g: 10, b: 10 })).toBe(
        0,
      );
      expect(calculateApcaLightnessContrast(white, darkRed)).toBeGreaterThan(50);
    });

    it("retrieves badge info for all palettes and handles unknown fallback", () => {
      const keys = [
        "critical",
        "warning",
        "open",
        "admitted",
        "resolved",
        "declined",
        "ignored",
        "unknown_key",
      ];
      for (const k of keys) {
        const badge = getApcaBadgeInfo(k);
        expect(badge.label).toBe(k);
        expect(typeof badge.lc).toBe("number");
        expect(badge.badge_text).toContain(k.toUpperCase());
        expect(renderApcaContrastBadge(k)).toBe(badge.badge_text);
      }
    });
  });

  describe("renderAsciiDefectTable & formatDefectAuditReport", () => {
    it("renders empty table and populated table with truncation", () => {
      expect(renderAsciiDefectTable([])).toContain(
        "No recorded defects discovered matching filter criteria",
      );
      const defect = createDefect("def-very-long-identifier-that-exceeds-limit", {
        type: "very_long_defect_type_exceeding_column_width",
      });
      const popTable = renderAsciiDefectTable([defect]);
      expect(popTable).toContain("Defect ID");
      expect(popTable).toContain("def-very-long-identifie…");
    });

    it("formats defect audit report with all sections and flags", () => {
      const defect1 = createDefect("d1", { candidate_id: "cand-1" });
      const defect2 = createDefect("d2", { status: "resolved", severity: "warning" });
      const summary: DefectAuditSummary = {
        total_defects: 2,
        open_count: 1,
        admitted_count: 0,
        resolved_count: 1,
        declined_count: 0,
        critical_count: 1,
        warning_count: 1,
        by_category: { code_defect: 2 },
        by_capsule: { "capsule-1": 2 },
        apca_contrast_compliance: {
          compliant_badges: 6,
          total_badges: 6,
          min_lc_observed: 75.0,
          passes_apca: true,
          badge_details: [getApcaBadgeInfo("open")],
        },
      };

      const rep = formatDefectAuditReport({
        capsulesDir: "/virtual/capsules",
        runRoot: "/virtual/run",
        defects: [defect1, defect2],
        summary,
        autoAdmittedCount: 1,
        autoAdmittedCandidates: ["cand-1"],
        isAll: true,
        promotedCount: 1,
        promotedDefects: ["d2"],
        generatedTestsCount: 2,
      });
      expect(rep).toContain("Defect Audit & Observability Report");
      expect(rep).toContain("Auto-Admitted Candidates");
      expect(rep).toContain("Promoted to COMPLETED_DEFECTS");
      expect(rep).toContain("Regression Tests Generated");

      const repNoRoot = formatDefectAuditReport({
        capsulesDir: "/virtual/capsules",
        runRoot: null,
        defects: [],
        summary,
        autoAdmittedCount: 0,
        autoAdmittedCandidates: [],
      });
      expect(repNoRoot).toContain("- **Active Run Root**: *none*");
    });
  });
});
