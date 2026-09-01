import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs";
import {
  buildCoverageSummary,
  calculatePct,
  computeIsMain,
  createMetricItem,
  parseLcov,
  writeSummaryJson,
} from "../../../scripts/testing/reporting/index.ts";
import type {
  CoverageSummary,
  FileCoverageMetric,
} from "../../../scripts/testing/reporting/types.ts";
import { cleanupVirtualReportingFS, setupVirtualReportingFS, tempDir } from "../fixture.ts";

export const coverageLcovSuiteName = "Coverage LCOV Parsing & Summary Calculations";

describe(coverageLcovSuiteName, () => {
  beforeEach(() => {
    setupVirtualReportingFS();
  });

  afterEach(() => {
    cleanupVirtualReportingFS();
  });

  describe("types and metric helpers", () => {
    it("calculatePct handles zero and negative totals gracefully", () => {
      expect(calculatePct(0, 0)).toBe(100);
      expect(calculatePct(5, 0)).toBe(100);
      expect(calculatePct(10, -5)).toBe(100);
    });

    it("calculatePct computes accurate percentages with standard rounding", () => {
      expect(calculatePct(0, 10)).toBe(0);
      expect(calculatePct(5, 10)).toBe(50);
      expect(calculatePct(10, 10)).toBe(100);
      expect(calculatePct(1, 3)).toBe(33.33);
      expect(calculatePct(2, 3)).toBe(66.67);
      expect(calculatePct(1, 7)).toBe(14.29);
      expect(calculatePct(6, 7)).toBe(85.71);
    });

    it("createMetricItem constructs MetricItem correctly with 0 skipped", () => {
      const metric = createMetricItem(8, 10);
      expect(metric.total).toBe(10);
      expect(metric.covered).toBe(8);
      expect(metric.skipped).toBe(0);
      expect(metric.pct).toBe(80);
    });

    it("computeIsMain detects main and argv path correctly across all branches", () => {
      expect(computeIsMain(true, undefined)).toBe(true);
      expect(computeIsMain(true, "/some/path")).toBe(true);
      expect(computeIsMain(false, undefined)).toBe(false);
      expect(computeIsMain(false, "")).toBe(false);
      expect(computeIsMain(false, "/repo/scripts/testing/reporting/index.ts")).toBe(true);
      expect(computeIsMain(false, "/repo/scripts/testing/reporting")).toBe(true);
      expect(computeIsMain(false, "/repo/other-script.ts")).toBe(false);
      expect(typeof computeIsMain()).toBe("boolean");
    });
  });

  describe("lcov-parser", () => {
    it("parseLcov handles empty string and whitespace-only content", () => {
      const emptyMap = parseLcov("");
      expect(emptyMap.size).toBe(0);

      const whitespaceMap = parseLcov("   \n\n\t  \n  ");
      expect(whitespaceMap.size).toBe(0);
    });

    it("parseLcov parses valid LCOV records with all sections", () => {
      const tmpRoot = tempDir("cov-lcov-parse");
      const lcovSample = `
SF:src/utils/math.ts
FNF:4
FNH:3
LF:20
LH:18
DA:1,5
DA:2,5
DA:3,0
DA:4,1
DA:5,0
end_of_record
`;
      const fileMap = parseLcov(lcovSample, tmpRoot);
      expect(fileMap.size).toBe(1);

      const metric = fileMap.get("src/utils/math.ts");
      expect(metric).toBeDefined();
      if (!metric) return;

      expect(metric.file).toBe("src/utils/math.ts");
      expect(metric.lines.total).toBe(20);
      expect(metric.lines.covered).toBe(18);
      expect(metric.lines.pct).toBe(90);
      expect(metric.statements.total).toBe(20);
      expect(metric.statements.covered).toBe(18);
      expect(metric.functions.total).toBe(4);
      expect(metric.functions.covered).toBe(3);
      expect(metric.functions.pct).toBe(75);
      expect(metric.uncoveredLines).toEqual([3, 5]);
      expect(metric.lineHits.get(1)).toBe(5);
      expect(metric.lineHits.get(3)).toBe(0);
      expect(metric.lineHits.get(4)).toBe(1);
    });

    it("parseLcov handles default repoRoot when omitted", () => {
      const lcovSample = `
SF:src/index.ts
LF:10
LH:10
DA:1,1
end_of_record
`;
      const fileMap = parseLcov(lcovSample);
      expect(fileMap.size).toBe(1);
    });

    it("parseLcov handles invalid/missing numbers and malformed DA lines gracefully", () => {
      const tmpRoot = tempDir("cov-lcov-malformed");
      const lcovSample = `
SF:src/broken.ts
FNF:invalid
FNH:
LF:NaN
LH:abc
DA:invalid,notanumber
DA:0,5
DA:-1,2
DA:10
DA:12,3
end_of_record
SF:src/unclosed.ts
LF:5
LH:5
`;
      const fileMap = parseLcov(lcovSample, tmpRoot);
      expect(fileMap.size).toBe(1);

      const metric = fileMap.get("src/broken.ts");
      expect(metric).toBeDefined();
      if (!metric) return;

      expect(metric.functions.total).toBe(0);
      expect(metric.functions.covered).toBe(0);
      expect(metric.lines.total).toBe(0);
      expect(metric.lines.covered).toBe(0);
      expect(metric.lineHits.get(10)).toBe(0);
      expect(metric.lineHits.get(12)).toBe(3);
      expect(metric.uncoveredLines).toEqual([10]);
    });
  });

  describe("summary-reporter", () => {
    it("buildCoverageSummary aggregates metrics across multiple files accurately", () => {
      const fileMap = new Map<string, FileCoverageMetric>();
      fileMap.set("fileA.ts", {
        file: "fileA.ts",
        lines: createMetricItem(8, 10),
        statements: createMetricItem(8, 10),
        functions: createMetricItem(1, 2),
        uncoveredLines: [3, 7],
        lineHits: new Map([
          [1, 1],
          [3, 0],
          [7, 0],
        ]),
      });
      fileMap.set("fileB.ts", {
        file: "fileB.ts",
        lines: createMetricItem(10, 10),
        statements: createMetricItem(10, 10),
        functions: createMetricItem(2, 2),
        uncoveredLines: [],
        lineHits: new Map([
          [1, 1],
          [2, 2],
        ]),
      });

      const summary = buildCoverageSummary(fileMap);
      expect(summary.total).toBeDefined();
      expect(summary.total.lines.total).toBe(20);
      expect(summary.total.lines.covered).toBe(18);
      expect(summary.total.lines.pct).toBe(90);
      expect(summary.total.statements.total).toBe(20);
      expect(summary.total.statements.covered).toBe(18);
      expect(summary.total.statements.pct).toBe(90);
      expect(summary.total.functions.total).toBe(4);
      expect(summary.total.functions.covered).toBe(3);
      expect(summary.total.functions.pct).toBe(75);

      expect(summary["fileA.ts"]).toBeDefined();
      expect(summary["fileA.ts"]?.lines.pct).toBe(80);
      expect(summary["fileB.ts"]).toBeDefined();
      expect(summary["fileB.ts"]?.lines.pct).toBe(100);
    });

    it("buildCoverageSummary handles runtime and empty fileMap", () => {
      const summary = buildCoverageSummary(new Map(), {
        totalTests: 10,
        passedTests: 10,
        failedTests: 0,
        skippedTests: 0,
        durationMs: 120,
      });
      expect(summary.total).toBeDefined();
      expect(summary.total.lines.total).toBe(0);
      expect(summary.total.lines.covered).toBe(0);
      expect(summary.total.lines.pct).toBe(100);
      expect(summary.runtime?.totalTests).toBe(10);
    });

    it("writeSummaryJson writes valid JSON file and creates directory if missing", () => {
      const tmpRoot = tempDir("cov-lcov-summary");
      const summary: CoverageSummary = {
        total: {
          lines: createMetricItem(10, 10),
          statements: createMetricItem(10, 10),
          functions: createMetricItem(2, 2),
        },
      };

      const skippedPath = writeSummaryJson(summary, tmpRoot, "cov-output", { writeToDisk: false });
      expect(skippedPath).toContain("coverage-summary.json");

      const outPath = writeSummaryJson(summary, tmpRoot, "cov-output", {
        runtime: { totalTests: 5, passedTests: 5, failedTests: 0, skippedTests: 0, durationMs: 50 },
      });
      expect(fs.existsSync(outPath)).toBe(true);

      const content = fs.readFileSync(outPath, "utf-8");
      const parsed = JSON.parse(content) as CoverageSummary;
      expect(parsed.total?.lines.pct).toBe(100);
      expect(parsed.runtime?.totalTests).toBe(5);

      const outPath2 = writeSummaryJson(summary, tmpRoot, "cov-output", {
        runtime: { totalTests: 5, passedTests: 5, failedTests: 0, skippedTests: 0, durationMs: 50 },
      });
      expect(outPath2).toBe(outPath);

      // Verify read error recovery during write
      const readSpy = spyOn(fs, "readFileSync").mockImplementationOnce(() => {
        throw new Error("EACCES");
      });
      const outPath3 = writeSummaryJson(summary, tmpRoot, "cov-output", {
        runtime: { totalTests: 5, passedTests: 5, failedTests: 0, skippedTests: 0, durationMs: 50 },
      });
      expect(outPath3).toBe(outPath);
      readSpy.mockRestore();
    });
  });
});
