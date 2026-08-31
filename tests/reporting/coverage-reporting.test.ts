import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as reporting from "../../scripts/testing/reporting/index.ts";
import {
  buildHtmlDocument,
  extractCoverageFileData,
  generateInteractiveHtml,
  getClientScript,
  getHtmlStyles,
  writeInteractiveHtml,
} from "../../scripts/testing/reporting/html/index.ts";
import { getClientScriptHelpers } from "../../scripts/testing/reporting/html/client-script-helpers.ts";
import { getCodeViewerStyles } from "../../scripts/testing/reporting/html/styles-code-viewer.ts";
import {
  buildCoverageSummary,
  calculatePct,
  computeIsMain,
  createMetricItem,
  main,
  parseLcov,
  processCoverageArtifacts,
  writeMarkdownReport,
  writeSummaryJson,
} from "../../scripts/testing/reporting/index.ts";
import { buildMarkdownReport } from "../../scripts/testing/reporting/markdown-reporter.ts";
import type {
  CoverageSummary,
  FileCoverageMetric,
} from "../../scripts/testing/reporting/types.ts";

describe("Testing & Reporting Subsystem - Comprehensive Unit Tests", () => {
  const tmpRoot = join(process.cwd(), ".tmp-test-reporting-suite");

  function cleanupTmp(): void {
    if (existsSync(tmpRoot)) {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  }

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

    it("buildCoverageSummary handles empty fileMap", () => {
      const summary = buildCoverageSummary(new Map());
      expect(summary.total).toBeDefined();
      expect(summary.total.lines.total).toBe(0);
      expect(summary.total.lines.covered).toBe(0);
      expect(summary.total.lines.pct).toBe(100);
    });

    it("writeSummaryJson writes valid JSON file and creates directory if missing", () => {
      cleanupTmp();
      const summary: CoverageSummary = {
        total: {
          lines: createMetricItem(10, 10),
          statements: createMetricItem(10, 10),
          functions: createMetricItem(2, 2),
        },
      };

      const outPath = writeSummaryJson(summary, tmpRoot, "cov-output");
      expect(existsSync(outPath)).toBe(true);

      const content = readFileSync(outPath, "utf-8");
      const parsed = JSON.parse(content) as CoverageSummary;
      expect(parsed.total?.lines.pct).toBe(100);

      // Re-write when directory already exists
      const outPath2 = writeSummaryJson(summary, tmpRoot, "cov-output");
      expect(outPath2).toBe(outPath);

      cleanupTmp();
    });
  });

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

      // Re-write when directory already exists
      const reportPath2 = writeMarkdownReport(fileMap, summary, tmpRoot, "cov-report");
      expect(reportPath2).toBe(reportPath);

      cleanupTmp();
    });
  });

  describe("html styles, code viewer, and templates", () => {
    it("getHtmlStyles returns valid CSS string containing core theme and viewer tokens", () => {
      const styles = getHtmlStyles();
      expect(styles).toContain(":root");
      expect(styles).toContain("--bg-base");
      expect(styles).toContain("--brand-accent");
      expect(styles).toContain("metrics-grid");
      expect(styles).toContain(".code-container");
    });

    it("getCodeViewerStyles returns code viewer specific CSS rules", () => {
      const styles = getCodeViewerStyles();
      expect(styles).toContain(".file-viewer-header");
      expect(styles).toContain(".missed-chips-bar");
      expect(styles).toContain(".code-line.hit");
      expect(styles).toContain(".code-line.miss");
      expect(styles).toContain(".line-num");
    });

    it("buildHtmlDocument formats valid HTML5 document embedding styles and script", () => {
      const doc = buildHtmlDocument("/* custom-styles */", "/* custom-script */");
      expect(doc).toContain("<!DOCTYPE html>");
      expect(doc).toContain("<title>Test Coverage Dashboard - @onurseckin/skills</title>");
      expect(doc).toContain("/* custom-styles */");
      expect(doc).toContain("/* custom-script */");
      expect(doc).toContain('id="val-lines"');
      expect(doc).toContain('id="breadcrumbs"');
      expect(doc).toContain('id="content-view"');
    });

    it("getClientScript generates client JS including payload JSON", () => {
      const script = getClientScript('{"foo":"bar"}');
      expect(script).toContain('const DATA = {"foo":"bar"};');
      expect(script).toContain("function initMetrics()");
      expect(script).toContain("function setFilter(");
      expect(script).toContain("function renderBreadcrumbs()");
      expect(script).toContain("function renderFolderView()");
      expect(script).toContain("function createGaugeSvg(");
    });

    it("getClientScriptHelpers returns helper functions string", () => {
      const helpers = getClientScriptHelpers();
      expect(helpers).toContain("function getFolderLinesPct(");
      expect(helpers).toContain("function getFolderFuncsPct(");
      expect(helpers).toContain("function setSort(");
      expect(helpers).toContain("function renderFileView()");
      expect(helpers).toContain("function escapeHtml(");
      expect(helpers).toContain("function jumpToLine(");
      expect(helpers).toContain("function copyPath(");
    });
  });

  describe("html data-extractor", () => {
    it("extractCoverageFileData extracts file info and handles missing files & read errors gracefully", () => {
      cleanupTmp();
      mkdirSync(join(tmpRoot, "src"), { recursive: true });
      const testSource = "function test() {\n  return 42;\n}\n";
      const srcFile = join(tmpRoot, "src/sample.ts");
      writeFileSync(srcFile, testSource, "utf-8");

      const fileMap = new Map<string, FileCoverageMetric>();
      fileMap.set("src/sample.ts", {
        file: "src/sample.ts",
        lines: createMetricItem(2, 2),
        statements: createMetricItem(2, 2),
        functions: createMetricItem(1, 1),
        uncoveredLines: [],
        lineHits: new Map([
          [1, 1],
          [2, 1],
        ]),
      });
      fileMap.set("src/missing.ts", {
        file: "src/missing.ts",
        lines: createMetricItem(0, 1),
        statements: createMetricItem(0, 1),
        functions: createMetricItem(0, 1),
        uncoveredLines: [1],
        lineHits: new Map([[1, 0]]),
      });

      const extracted = extractCoverageFileData(fileMap, tmpRoot);
      expect(extracted.length).toBe(2);

      const existingData = extracted.find((f) => f.path === "src/sample.ts");
      expect(existingData).toBeDefined();
      expect(existingData?.linesPct).toBe(100);
      expect(existingData?.sourceLines).toBeDefined();
      expect(existingData?.sourceLines?.length).toBe(4);
      expect(existingData?.sourceLines?.[0]?.isExecutable).toBe(true);
      expect(existingData?.sourceLines?.[0]?.hits).toBe(1);
      expect(existingData?.sourceLines?.[2]?.isExecutable).toBe(false);
      expect(existingData?.sourceLines?.[2]?.hits).toBeUndefined();

      const missingData = extracted.find((f) => f.path === "src/missing.ts");
      expect(missingData).toBeDefined();
      expect(missingData?.sourceLines).toBeUndefined();

      // Test readFileSync error catch path
      const directoryAsFile = join(tmpRoot, "src/dir_as_file");
      mkdirSync(directoryAsFile, { recursive: true });
      const brokenMap = new Map<string, FileCoverageMetric>();
      brokenMap.set("src/dir_as_file", {
        file: "src/dir_as_file",
        lines: createMetricItem(0, 1),
        statements: createMetricItem(0, 1),
        functions: createMetricItem(0, 1),
        uncoveredLines: [1],
        lineHits: new Map([[1, 0]]),
      });

      const brokenExtracted = extractCoverageFileData(brokenMap, tmpRoot);
      expect(brokenExtracted.length).toBe(1);
      expect(brokenExtracted[0]?.sourceLines).toBeUndefined();

      cleanupTmp();
    });
  });

  describe("html generator and writer", () => {
    it("generateInteractiveHtml embeds files, breadcrumbs, and safely escapes script tags", () => {
      cleanupTmp();
      const fileMap = new Map<string, FileCoverageMetric>();
      fileMap.set("src/test.ts", {
        file: "src/test.ts",
        lines: createMetricItem(5, 5),
        statements: createMetricItem(5, 5),
        functions: createMetricItem(1, 1),
        uncoveredLines: [],
        lineHits: new Map([[1, 1]]),
      });
      const summary = buildCoverageSummary(fileMap);

      const html = generateInteractiveHtml(fileMap, summary, tmpRoot);
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("src/test.ts");
      expect(html).not.toContain('</script>"}');

      // Fallback summary without total
      const emptySummary: CoverageSummary = {};
      const htmlFallback = generateInteractiveHtml(fileMap, emptySummary, tmpRoot);
      expect(htmlFallback).toContain("<!DOCTYPE html>");
      expect(htmlFallback).toContain('"total":{"lines":{"total":0');

      cleanupTmp();
    });

    it("writeInteractiveHtml writes index.html file and creates directory if missing", () => {
      cleanupTmp();
      const fileMap = new Map<string, FileCoverageMetric>();
      const summary = buildCoverageSummary(fileMap);

      const outPath = writeInteractiveHtml(fileMap, summary, tmpRoot, "cov-html");
      expect(existsSync(outPath)).toBe(true);

      const content = readFileSync(outPath, "utf-8");
      expect(content).toContain("<!DOCTYPE html>");

      // Re-write when directory already exists
      const outPath2 = writeInteractiveHtml(fileMap, summary, tmpRoot, "cov-html");
      expect(outPath2).toBe(outPath);

      cleanupTmp();
    });
  });

  describe("unified entrypoint processCoverageArtifacts, main, and computeIsMain", () => {
    it("returns lcovExists: false when lcov.info is missing", () => {
      cleanupTmp();
      const result = processCoverageArtifacts(tmpRoot, "missing-cov");
      expect(result.lcovExists).toBe(false);
      expect(result.filesCount).toBe(0);
      expect(result.totalPct).toBe(0);
      cleanupTmp();
    });

    it("orchestrates all 3 artifacts when lcov.info is present and handles missing coverageDir creation", () => {
      cleanupTmp();
      const covDir = join(tmpRoot, "custom-coverage");
      mkdirSync(covDir, { recursive: true });

      const lcovContent = `
SF:src/core/app.ts
LF:10
LH:10
DA:1,1
DA:2,1
end_of_record
`;
      writeFileSync(join(covDir, "lcov.info"), lcovContent, "utf-8");

      const result = processCoverageArtifacts(tmpRoot, "custom-coverage");
      expect(result.lcovExists).toBe(true);
      expect(result.filesCount).toBe(1);
      expect(result.totalPct).toBe(100);
      expect(result.summaryPath).toBeDefined();
      expect(result.reportPath).toBeDefined();
      expect(result.htmlPath).toBeDefined();

      if (result.summaryPath) expect(existsSync(result.summaryPath)).toBe(true);
      if (result.reportPath) expect(existsSync(result.reportPath)).toBe(true);
      if (result.htmlPath) expect(existsSync(result.htmlPath)).toBe(true);

      cleanupTmp();
    });

    it("processCoverageArtifacts with default arguments handles missing and present lcov", () => {
      cleanupTmp();
      mkdirSync(tmpRoot, { recursive: true });
      const origCwd = process.cwd();
      try {
        process.chdir(tmpRoot);
        // 1. Missing lcov
        const resMissing = processCoverageArtifacts();
        expect(resMissing.lcovExists).toBe(false);

        // 2. Present lcov
        const covDir = join(tmpRoot, "coverage");
        mkdirSync(covDir, { recursive: true });
        writeFileSync(
          join(covDir, "lcov.info"),
          "SF:src/index.ts\nLF:5\nLH:5\nDA:1,1\nend_of_record\n",
          "utf-8",
        );
        // Remove coverage dir to verify line 52 mkdirSync when writing artifacts
        const resPresent = processCoverageArtifacts();
        expect(resPresent.lcovExists).toBe(true);
        expect(resPresent.filesCount).toBe(1);
        expect(resPresent.totalPct).toBe(100);
      } finally {
        process.chdir(origCwd);
        cleanupTmp();
      }
    });

    it("main() logs appropriate status messages based on lcov existence", () => {
      cleanupTmp();
      mkdirSync(tmpRoot, { recursive: true });
      const origLog = console.log;
      const messages: string[] = [];
      console.log = (...args: readonly unknown[]): void => {
        messages.push(args.map(String).join(" "));
      };

      // 1. Without lcov
      const origCwd = process.cwd();
      try {
        process.chdir(tmpRoot);
        main();
        expect(messages.length).toBeGreaterThan(0);
        expect(messages.some((m) => m.includes("No coverage/lcov.info found"))).toBe(true);
      } finally {
        process.chdir(origCwd);
      }

      // 2. With lcov
      messages.length = 0;
      const covDir = join(tmpRoot, "coverage");
      mkdirSync(covDir, { recursive: true });
      writeFileSync(
        join(covDir, "lcov.info"),
        "SF:src/app.ts\nLF:5\nLH:5\nDA:1,1\nend_of_record\n",
        "utf-8",
      );

      try {
        process.chdir(tmpRoot);
        main();
        expect(messages.length).toBeGreaterThan(0);
        expect(messages.some((m) => m.includes("Generated coverage/lcov.info"))).toBe(true);
      } finally {
        process.chdir(origCwd);
        console.log = origLog;
        cleanupTmp();
      }
    });

    it("barrel export exports all expected symbols", () => {
      expect(reporting.calculatePct).toBeDefined();
      expect(reporting.createMetricItem).toBeDefined();
      expect(reporting.parseLcov).toBeDefined();
      expect(reporting.buildCoverageSummary).toBeDefined();
      expect(reporting.writeSummaryJson).toBeDefined();
      expect(reporting.buildMarkdownReport).toBeDefined();
      expect(reporting.writeMarkdownReport).toBeDefined();
      expect(reporting.buildHtmlDocument).toBeDefined();
      expect(reporting.extractCoverageFileData).toBeDefined();
      expect(reporting.generateInteractiveHtml).toBeDefined();
      expect(reporting.getClientScript).toBeDefined();
      expect(reporting.getHtmlStyles).toBeDefined();
      expect(reporting.writeInteractiveHtml).toBeDefined();
      expect(reporting.processCoverageArtifacts).toBeDefined();
      expect(reporting.computeIsMain).toBeDefined();
      expect(reporting.main).toBeDefined();
      expect(reporting.runCli).toBeDefined();
    });

    it("runCli executes main when isMain is true and skips when isMain is false", () => {
      const origLog = console.log;
      const messages: string[] = [];
      console.log = (...args: readonly unknown[]): void => {
        messages.push(args.map(String).join(" "));
      };
      try {
        // false branch
        reporting.runCli(false);
        expect(messages.length).toBe(0);

        // true branch
        reporting.runCli(true);
        expect(messages.length).toBeGreaterThan(0);

        // default parameter branch
        const beforeCount = messages.length;
        reporting.runCli();
        expect(messages.length).toBe(beforeCount);
      } finally {
        console.log = origLog;
      }
    });
  });
});
