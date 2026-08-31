import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  buildCoverageSummary,
  createMetricItem,
  writeMarkdownReport,
} from "../../../scripts/testing/reporting/index.ts";
import { buildMarkdownReport } from "../../../scripts/testing/reporting/markdown-reporter.ts";
import type {
  CoverageSummary,
  FileCoverageMetric,
} from "../../../scripts/testing/reporting/types.ts";

export const coverageMarkdownSuiteName = "Coverage Markdown Report Generation & Artifact Output";

describe(coverageMarkdownSuiteName, () => {
  const tmpRoot = join(process.cwd(), ".tmp-test-reporting-suite-markdown");

  function cleanupTmp(): void {
    if (existsSync(tmpRoot)) {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  }

  describe("markdown-reporter", () => {
    it("buildMarkdownReport formats table, status glyphs, and uncovered line lists", () => {
      const fileMap = new Map<string, FileCoverageMetric>();
      fileMap.set("src/perfect.ts", {
        file: "src/perfect.ts",
        lines: createMetricItem(10, 10),
        statements: createMetricItem(10, 10),
        functions: createMetricItem(2, 2),
        uncoveredLines: [],
        lineHits: new Map(),
      });
      fileMap.set("src/warning.ts", {
        file: "src/warning.ts",
        lines: createMetricItem(8, 10),
        statements: createMetricItem(8, 10),
        functions: createMetricItem(4, 5),
        uncoveredLines: [4, 8],
        lineHits: new Map(),
      });
      fileMap.set("src/critical.ts", {
        file: "src/critical.ts",
        lines: createMetricItem(5, 10),
        statements: createMetricItem(5, 10),
        functions: createMetricItem(1, 4),
        uncoveredLines: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        lineHits: new Map(),
      });

      const summary = buildCoverageSummary(fileMap);
      const markdown = buildMarkdownReport(fileMap, summary);

      expect(markdown).toContain("# Repository Unit Test Coverage Report");
      expect(markdown).toContain("## 📊 Executive Summary");
      expect(markdown).toContain("## 📁 Detailed File Breakdown");
      expect(markdown).toContain("`src/perfect.ts`");
      expect(markdown).toContain("_None (100%)_");
      expect(markdown).toContain("`src/warning.ts`");
      expect(markdown).toContain("4, 8");
      expect(markdown).toContain("`src/critical.ts`");
      expect(markdown).toContain("(+2 more)");
      expect(markdown).toContain("⚠️ NEEDS WORK");
    });

    it("buildMarkdownReport handles empty summary.total fallback", () => {
      const fileMap = new Map<string, FileCoverageMetric>();
      const emptySummary: CoverageSummary = {};
      const markdown = buildMarkdownReport(fileMap, emptySummary);
      expect(markdown).toContain("🟢 PASS");
      expect(markdown).toContain("**100%**");
    });

    it("writeMarkdownReport writes REPORT.md and creates directory if missing", () => {
      cleanupTmp();
      const fileMap = new Map<string, FileCoverageMetric>();
      const summary = buildCoverageSummary(fileMap);

      const reportPath = writeMarkdownReport(fileMap, summary, tmpRoot, "cov-report");
      expect(existsSync(reportPath)).toBe(true);

      const content = readFileSync(reportPath, "utf-8");
      expect(content).toContain("# Repository Unit Test Coverage Report");

      const reportPath2 = writeMarkdownReport(fileMap, summary, tmpRoot, "cov-report");
      expect(reportPath2).toBe(reportPath);

      cleanupTmp();
    });
  });
});
