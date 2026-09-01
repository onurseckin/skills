import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  calculateApcaLightnessContrast,
  defectAuditCommand,
  formatDefectAuditReport,
  getApcaBadgeInfo,
  renderApcaContrastBadge,
  renderAsciiDefectTable,
  type AuditedDefect,
  type DefectAuditSummary,
} from "../../../../../olt/scripts/src/cli/commands/defect-audit.ts";
import { HarnessError } from "../../../../../olt/scripts/src/core/errors/index.ts";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../../fixtures/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../../fixtures/task-ops-fixture.ts";

const roots: string[] = [];
beforeEach(() => setupVirtualCliFS());
afterEach(async () => {
  await cleanupRoots(roots);
  cleanupVirtualCliFS();
});

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

describe("defect-audit comprehensive suite", () => {
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

  describe("defectAuditCommand execution", () => {
    it("validates invalid timestamp, invalid capsules-dir, and missing run for auto-admit", () => {
      expect(() => defectAuditCommand({ now: "not-a-date" })).toThrow(HarnessError);
      expect(() => defectAuditCommand({ "capsules-dir": "/nonexistent/path/dir" })).toThrow(
        HarnessError,
      );
      expect(() => defectAuditCommand({ "auto-admit": true })).toThrow(HarnessError);
    });

    it("filters by status and category/type and validates filter values", async () => {
      const { run } = await setupCompiledRun("defect-audit-flt", roots);
      const dFile = join(run, "defects.jsonl");
      const dLines = [
        JSON.stringify({
          id: "d-open-1",
          type: "code_defect",
          severity: "critical",
          status: "open",
          observation: "Crash 1",
          remediation: "Fix 1",
          context: { category: "core_engine" },
        }),
        JSON.stringify({
          id: "d-res-1",
          type: "perf_defect",
          severity: "warning",
          status: "resolved",
          observation: "Slow 1",
          remediation: "Fix 2",
          context: { category: "database" },
          resolution: {
            task_id: "t1",
            test_assertion: "bun test tests/sample.test.ts",
            resolved_at: "2026-08-30T12:00:00.000Z",
          },
        }),
      ].join("\n");
      writeFileSync(dFile, dLines, "utf-8");

      expect(() => defectAuditCommand({ run, "filter-status": "invalid_status" })).toThrow(
        HarnessError,
      );
      expect(defectAuditCommand({ run, "filter-status": "open" }).filtered_defects).toHaveLength(1);
      expect(
        defectAuditCommand({ run, "filter-category": "database" }).filtered_defects,
      ).toHaveLength(1);
      expect(defectAuditCommand({ run, "filter-type": "code" }).filtered_defects).toHaveLength(1);
      expect(
        defectAuditCommand({ run, "filter-category": "all", "filter-status": "all", all: true })
          .filtered_defects,
      ).toHaveLength(2);
    });

    it("performs auto-admit, promotion, regression test generation and dry-run", async () => {
      const { repo, run } = await setupCompiledRun("defect-audit-flow", roots);
      const dLines = [
        JSON.stringify({
          id: "d-open-flow",
          type: "code_defect",
          severity: "critical",
          status: "open",
          observation: "Memory leak",
          remediation: "Free pointer",
          context: { category: "runtime" },
        }),
        JSON.stringify({
          id: "d-res-flow",
          type: "style_defect",
          severity: "warning",
          status: "resolved",
          observation: "Linter error",
          remediation: "Format code",
          context: { category: "style" },
          resolution: {
            task_id: "t2",
            test_assertion: "bun test tests/style.test.ts",
            resolved_at: "2026-08-30T12:00:00.000Z",
          },
        }),
      ].join("\n");
      writeFileSync(join(run, "defects.jsonl"), dLines, "utf-8");

      const compFile = join(repo, "completed-defects.jsonl");
      const testOutFile = join(repo, "sub-dir/generated-reg.test.ts");

      const res = defectAuditCommand({
        run,
        "auto-admit": true,
        "auto-promote": true,
        "completed-file": compFile,
        "generate-tests": true,
        "output-tests": testOutFile,
        now: "2026-08-30T12:00:00.000Z",
      });

      expect(res.auto_admitted_count).toBe(1);
      expect(res.auto_admitted_candidates).toContain("cand-defect-d-open-flow");
      expect(res.promoted_count).toBe(1);
      expect(res.promoted_defects).toContain("d-res-flow");
      expect(res.generated_tests).toBeDefined();
      expect(res.generated_test_suite).toBeDefined();
      expect(existsSync(compFile)).toBe(true);
      expect(existsSync(testOutFile)).toBe(true);

      const dryRes = defectAuditCommand({
        run,
        promote: "d-res-flow",
        "dry-run": true,
        "completed-file": compFile,
      });
      expect(dryRes.promoted_count).toBe(1);
    });

    it("resolves capsules directory and handles duplicate defect resolution overrides", () => {
      const cDir = "/virtual/capsules-dup";
      mkdirSync(join(cDir, ".git"), { recursive: true });
      mkdirSync(join(cDir, "cap-sub"), { recursive: true });
      roots.push(cDir);
      writeFileSync(
        join(cDir, "defects.jsonl"),
        JSON.stringify({
          id: "dup-1",
          type: "code",
          severity: "warning",
          status: "open",
          observation: "o",
          remediation: "r",
        }) + "\n",
        "utf-8",
      );
      writeFileSync(
        join(cDir, "cap-sub", "defects.jsonl"),
        JSON.stringify({
          id: "dup-1",
          type: "code",
          severity: "warning",
          status: "resolved",
          observation: "o",
          remediation: "r",
        }) + "\n",
        "utf-8",
      );

      const res = defectAuditCommand({ "capsules-dir": cDir });
      expect(res.capsules_dir).toBe(cDir);
      expect(res.total_defects).toBe(1);
      expect(res.filtered_defects[0]?.status).toBe("resolved");

      const runWithCapsules = "/virtual/run-with-caps";
      mkdirSync(join(runWithCapsules, ".git"), { recursive: true });
      mkdirSync(join(runWithCapsules, ".olt/capsules"), { recursive: true });
      roots.push(runWithCapsules);
      writeFileSync(join(runWithCapsules, ".olt/capsules", "defects.jsonl"), "", "utf-8");
      const runCapsRes = defectAuditCommand({ run: runWithCapsules });
      expect(runCapsRes.capsules_dir).toBe(join(runWithCapsules, ".olt/capsules"));
    });
  });
});
