import { describe, expect, test } from "bun:test";
import {
  DEFAULT_COVERAGE_THRESHOLD,
  evaluateCoverageGate,
  formatCoverageGateMessage,
  type CoverageGateOptions,
  type CoverageGateResult,
  type CoverageSummary,
} from "../../../scripts/testing/reporting/index.ts";

describe("Strict Coverage Quality Gate", () => {
  describe("evaluateCoverageGate", () => {
    test("passes when overall line coverage meets default 90% threshold and functions 95%", () => {
      const summary: CoverageSummary = {
        total: {
          lines: { total: 100, covered: 90, skipped: 0, pct: 90 },
          statements: { total: 100, covered: 90, skipped: 0, pct: 90 },
          functions: { total: 20, covered: 19, skipped: 0, pct: 95 },
        },
        "src/a.ts": {
          lines: { total: 50, covered: 45, skipped: 0, pct: 90 },
          statements: { total: 50, covered: 45, skipped: 0, pct: 90 },
          functions: { total: 10, covered: 10, skipped: 0, pct: 100 },
        },
        "src/b.ts": {
          lines: { total: 50, covered: 45, skipped: 0, pct: 90 },
          statements: { total: 50, covered: 45, skipped: 0, pct: 90 },
          functions: { total: 10, covered: 9, skipped: 0, pct: 90 },
        },
      };

      const result = evaluateCoverageGate(summary);
      expect(result.passed).toBe(true);
      expect(result.totalPct).toBe(90);
      expect(result.funcsPct).toBe(95);
      expect(result.thresholdPct).toBe(DEFAULT_COVERAGE_THRESHOLD);
      expect(result.deficitPct).toBe(0);
      expect(result.funcsDeficitPct).toBe(0);
      expect(result.filesCount).toBe(2);
      expect(result.failingFiles).toEqual([]);
      expect(result.totalLinesCovered).toBe(90);
      expect(result.totalLinesTotal).toBe(100);
    });

    test("passes when overall line and function coverage exceed thresholds (e.g. 96.5% and 100%)", () => {
      const summary: CoverageSummary = {
        total: {
          lines: { total: 200, covered: 193, skipped: 0, pct: 96.5 },
          statements: { total: 200, covered: 193, skipped: 0, pct: 96.5 },
          functions: { total: 20, covered: 20, skipped: 0, pct: 100 },
        },
      };

      const result = evaluateCoverageGate(summary);
      expect(result.passed).toBe(true);
      expect(result.totalPct).toBe(96.5);
      expect(result.funcsPct).toBe(100);
      expect(result.deficitPct).toBe(0);
    });

    test("fails when overall line coverage is below 90% threshold and computes deficit", () => {
      const summary: CoverageSummary = {
        total: {
          lines: { total: 100, covered: 85, skipped: 0, pct: 85 },
          statements: { total: 100, covered: 85, skipped: 0, pct: 85 },
          functions: { total: 10, covered: 8, skipped: 0, pct: 80 },
        },
        "src/module.ts": {
          lines: { total: 100, covered: 85, skipped: 0, pct: 85 },
          statements: { total: 100, covered: 85, skipped: 0, pct: 85 },
          functions: { total: 10, covered: 8, skipped: 0, pct: 80 },
        },
      };

      const result = evaluateCoverageGate(summary);
      expect(result.passed).toBe(false);
      expect(result.totalPct).toBe(85);
      expect(result.thresholdPct).toBe(90);
      expect(result.deficitPct).toBe(5);
      expect(result.filesCount).toBe(1);
    });

    test("supports custom threshold and calculates deficit accordingly", () => {
      const summary: CoverageSummary = {
        total: {
          lines: { total: 100, covered: 92, skipped: 0, pct: 92 },
          statements: { total: 100, covered: 92, skipped: 0, pct: 92 },
          functions: { total: 10, covered: 9, skipped: 0, pct: 90 },
        },
      };

      const options: CoverageGateOptions = { threshold: 95.0 };
      const result = evaluateCoverageGate(summary, options);
      expect(result.passed).toBe(false);
      expect(result.totalPct).toBe(92);
      expect(result.thresholdPct).toBe(95.0);
      expect(result.deficitPct).toBe(3.0);
    });

    test("supports per-file line threshold check and captures failing files", () => {
      const summary: CoverageSummary = {
        total: {
          lines: { total: 200, covered: 185, skipped: 0, pct: 92.5 },
          statements: { total: 200, covered: 185, skipped: 0, pct: 92.5 },
          functions: { total: 20, covered: 18, skipped: 0, pct: 90 },
        },
        "src/pass.ts": {
          lines: { total: 100, covered: 98, skipped: 0, pct: 98 },
          statements: { total: 100, covered: 98, skipped: 0, pct: 98 },
          functions: { total: 10, covered: 10, skipped: 0, pct: 100 },
        },
        "src/fail.ts": {
          lines: { total: 100, covered: 87, skipped: 0, pct: 87 },
          statements: { total: 100, covered: 87, skipped: 0, pct: 87 },
          functions: { total: 10, covered: 8, skipped: 0, pct: 80 },
        },
      };

      const result = evaluateCoverageGate(summary, { threshold: 90.0, fileThreshold: 90.0 });
      expect(result.passed).toBe(false);
      expect(result.totalPct).toBe(92.5);
      expect(result.failingFiles.length).toBe(1);
      expect(result.failingFiles[0]?.file).toBe("src/fail.ts");
      expect(result.failingFiles[0]?.linesPct).toBe(87);
    });

    test("handles empty or missing summary.total gracefully", () => {
      const emptySummary: CoverageSummary = {};
      const result = evaluateCoverageGate(emptySummary);
      expect(result.passed).toBe(false);
      expect(result.totalPct).toBe(0);
      expect(result.totalLinesCovered).toBe(0);
      expect(result.totalLinesTotal).toBe(0);
      expect(result.deficitPct).toBe(90);
    });
  });

  describe("formatCoverageGateMessage", () => {
    test("formats passing message with percentage, threshold, line counts and files", () => {
      const passResult: CoverageGateResult = {
        passed: true,
        totalPct: 94.5,
        thresholdPct: 90.0,
        deficitPct: 0,
        filesCount: 15,
        failingFiles: [],
        totalLinesCovered: 945,
        totalLinesTotal: 1000,
      };

      const msg = formatCoverageGateMessage(passResult);
      expect(msg).toContain("✓ [coverage-gate] Quality Gate PASSED");
      expect(msg).toContain("94.5%");
      expect(msg).toContain(">= 90%");
      expect(msg).toContain("945/1000 lines across 15 files");
    });

    test("formats failing message with deficit and list of failing files", () => {
      const failResult: CoverageGateResult = {
        passed: false,
        totalPct: 82.0,
        thresholdPct: 90.0,
        deficitPct: 8.0,
        filesCount: 3,
        failingFiles: [{ file: "src/bad.ts", linesPct: 60.0, linesCovered: 60, linesTotal: 100 }],
        totalLinesCovered: 246,
        totalLinesTotal: 300,
      };

      const msg = formatCoverageGateMessage(failResult);
      expect(msg).toContain("❌ [coverage-gate] Quality Gate FAILED");
      expect(msg).toContain("82%");
      expect(msg).toContain("90%");
      expect(msg).toContain("Deficit: -8%");
      expect(msg).toContain("src/bad.ts: 60% (60/100 lines)");
    });
  });
});
