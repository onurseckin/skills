import { describe, expect, test, beforeEach, afterEach, afterAll } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  calculatePct,
  createMetricItem,
  parseLcov,
  buildCoverageSummary,
  writeSummaryJson,
  buildMarkdownReport,
  writeMarkdownReport,
  generateInteractiveHtml,
  writeInteractiveHtml,
  getHtmlStyles,
  getClientScript,
  buildHtmlDocument,
  extractCoverageFileData,
  processCoverageArtifacts,
} from "../../../scripts/testing/reporting/index.ts";

const TEST_SCRATCH_DIR = join(process.cwd(), "coverage/scratch/coverage-reporting-test");

describe("Coverage Reporting Modules", () => {
  beforeEach(() => {
    rmSync(TEST_SCRATCH_DIR, { recursive: true, force: true });
    mkdirSync(TEST_SCRATCH_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_SCRATCH_DIR, { recursive: true, force: true });
  });

  afterAll(() => {
    rmSync(TEST_SCRATCH_DIR, { recursive: true, force: true });
  });

  describe("types and metric helpers", () => {
    test("calculatePct handles zero total gracefully", () => {
      expect(calculatePct(0, 0)).toBe(100);
      expect(calculatePct(5, 0)).toBe(100);
    });

    test("calculatePct computes rounded percentages", () => {
      expect(calculatePct(50, 100)).toBe(50);
      expect(calculatePct(1, 3)).toBe(33.33);
      expect(calculatePct(2, 3)).toBe(66.67);
      expect(calculatePct(10, 10)).toBe(100);
    });

    test("createMetricItem constructs MetricItem correctly", () => {
      const metric = createMetricItem(8, 10);
      expect(metric.total).toBe(10);
      expect(metric.covered).toBe(8);
      expect(metric.skipped).toBe(0);
      expect(metric.pct).toBe(80);
    });
  });

  describe("lcov-parser", () => {
    test("parseLcov parses valid LCOV record correctly", () => {
      const sampleLcov = [
        "SF:src/foo.ts",
        "FNF:2",
        "FNH:1",
        "LF:10",
        "LH:8",
        "DA:1,1",
        "DA:2,1",
        "DA:3,0",
        "DA:4,1",
        "DA:5,0",
        "end_of_record",
      ].join("\n");

      const fileMap = parseLcov(sampleLcov, TEST_SCRATCH_DIR);
      expect(fileMap.size).toBe(1);

      const metric = fileMap.get("src/foo.ts");
      expect(metric).toBeDefined();
      if (!metric) return;

      expect(metric.lines.total).toBe(10);
      expect(metric.lines.covered).toBe(8);
      expect(metric.lines.pct).toBe(80);
      expect(metric.statements.total).toBe(10);
      expect(metric.statements.covered).toBe(8);
      expect(metric.statements.pct).toBe(80);
      expect(metric.functions.total).toBe(2);
      expect(metric.functions.covered).toBe(1);
      expect(metric.functions.pct).toBe(50);
      expect(metric.uncoveredLines).toEqual([3, 5]);
      expect(metric.lineHits.get(1)).toBe(1);
      expect(metric.lineHits.get(3)).toBe(0);
    });

    test("parseLcov handles empty content", () => {
      const fileMap = parseLcov("", TEST_SCRATCH_DIR);
      expect(fileMap.size).toBe(0);
    });
  });

  describe("summary-reporter", () => {
    test("buildCoverageSummary aggregates metrics across multiple files", () => {
      const sampleLcov = [
        "SF:src/a.ts",
        "FNF:1",
        "FNH:1",
        "LF:10",
        "LH:10",
        "end_of_record",
        "SF:src/b.ts",
        "FNF:2",
        "FNH:1",
        "LF:10",
        "LH:5",
        "end_of_record",
      ].join("\n");

      const fileMap = parseLcov(sampleLcov, TEST_SCRATCH_DIR);
      const summary = buildCoverageSummary(fileMap);

      expect(summary["src/a.ts"]).toBeDefined();
      expect(summary["src/b.ts"]).toBeDefined();
      expect(summary.total).toBeDefined();

      expect(summary.total.lines.total).toBe(20);
      expect(summary.total.lines.covered).toBe(15);
      expect(summary.total.lines.pct).toBe(75);
      expect(summary.total.statements.total).toBe(20);
      expect(summary.total.statements.covered).toBe(15);
      expect(summary.total.statements.pct).toBe(75);
      expect(summary.total.functions.total).toBe(3);
      expect(summary.total.functions.covered).toBe(2);
    });

    test("writeSummaryJson writes valid JSON file", () => {
      const sampleLcov = "SF:src/a.ts\nLF:5\nLH:5\nend_of_record";
      const fileMap = parseLcov(sampleLcov, TEST_SCRATCH_DIR);
      const summary = buildCoverageSummary(fileMap);

      const summaryPath = writeSummaryJson(summary, TEST_SCRATCH_DIR, "cov");
      expect(existsSync(summaryPath)).toBe(true);

      const parsed = JSON.parse(readFileSync(summaryPath, "utf-8"));
      expect(parsed["src/a.ts"]).toBeDefined();
      expect(parsed.total.lines.pct).toBe(100);
    });
  });

  describe("markdown-reporter", () => {
    test("buildMarkdownReport formats table and status correctly", () => {
      const sampleLcov = [
        "SF:src/good.ts",
        "LF:10",
        "LH:10",
        "FNF:1",
        "FNH:1",
        "end_of_record",
        "SF:src/bad.ts",
        "LF:10",
        "LH:2",
        "FNF:2",
        "FNH:0",
        "DA:1,0",
        "DA:2,0",
        "end_of_record",
      ].join("\n");

      const fileMap = parseLcov(sampleLcov, TEST_SCRATCH_DIR);
      const summary = buildCoverageSummary(fileMap);
      const markdown = buildMarkdownReport(fileMap, summary);

      expect(markdown).toContain("# Repository Unit Test Coverage Report");
      expect(markdown).toContain("`src/good.ts`");
      expect(markdown).toContain("`src/bad.ts`");
      expect(markdown).toContain("🟢 100%");
      expect(markdown).toContain("🔴 20%");
    });

    test("writeMarkdownReport writes REPORT.md file", () => {
      const sampleLcov = "SF:src/a.ts\nLF:5\nLH:5\nend_of_record";
      const fileMap = parseLcov(sampleLcov, TEST_SCRATCH_DIR);
      const summary = buildCoverageSummary(fileMap);

      const reportPath = writeMarkdownReport(fileMap, summary, TEST_SCRATCH_DIR, "cov");
      expect(existsSync(reportPath)).toBe(true);
      expect(readFileSync(reportPath, "utf-8")).toContain("# Repository Unit Test Coverage Report");
    });
  });

  describe("html-reporter", () => {
    test("getHtmlStyles returns valid CSS string", () => {
      const styles = getHtmlStyles();
      expect(styles).toContain(":root");
      expect(styles).toContain("--bg-base");
      expect(styles).toContain(".radial-gauge");
      expect(styles).toContain(".code-line.miss");
    });

    test("getClientScript generates functional client JS", () => {
      const script = getClientScript('{"total":{"lines":{"pct":100}},"files":[]}');
      expect(script).toContain("const DATA = ");
      expect(script).toContain("function renderBreadcrumbs()");
      expect(script).toContain("function jumpToLine(");
    });

    test("buildHtmlDocument formats valid HTML5 document", () => {
      const html = buildHtmlDocument("body { color: red; }", "console.log('hi');");
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<style>\nbody { color: red; }\n  </style>");
      expect(html).toContain("<script>\nconsole.log('hi');\n  </script>");
    });

    test("extractCoverageFileData extracts file info and handles missing files gracefully", () => {
      const dummyFile = join(TEST_SCRATCH_DIR, "src/a.ts");
      mkdirSync(join(TEST_SCRATCH_DIR, "src"), { recursive: true });
      writeFileSync(dummyFile, "line1\nline2", "utf-8");

      const sampleLcov = [
        "SF:src/a.ts",
        "LF:2",
        "LH:1",
        "FNF:1",
        "FNH:1",
        "DA:1,1",
        "DA:2,0",
        "end_of_record",
        "SF:src/missing.ts",
        "LF:1",
        "LH:1",
        "FNF:1",
        "FNH:1",
        "DA:1,1",
        "end_of_record",
      ].join("\n");

      const fileMap = parseLcov(sampleLcov, TEST_SCRATCH_DIR);
      const filesData = extractCoverageFileData(fileMap, TEST_SCRATCH_DIR);

      expect(filesData.length).toBe(2);
      const fileA = filesData.find((f) => f.path === "src/a.ts");
      expect(fileA).toBeDefined();
      expect(fileA?.sourceLines?.length).toBe(2);
      expect(fileA?.sourceLines?.[0]?.hits).toBe(1);
      expect(fileA?.sourceLines?.[1]?.hits).toBe(0);

      const fileMissing = filesData.find((f) => f.path === "src/missing.ts");
      expect(fileMissing).toBeDefined();
      expect(fileMissing?.sourceLines).toBeUndefined();
    });

    test("generateInteractiveHtml embeds files, breadcrumbs, and precision line highlights", () => {
      const dummyFile = join(TEST_SCRATCH_DIR, "src/sample.ts");
      mkdirSync(join(TEST_SCRATCH_DIR, "src"), { recursive: true });
      writeFileSync(dummyFile, "const a = 1;\nconst b = 2;\n// comment\nconst c = 3;\n", "utf-8");

      const sampleLcov = [
        "SF:src/sample.ts",
        "LF:3",
        "LH:2",
        "FNF:1",
        "FNH:1",
        "DA:1,1",
        "DA:2,0",
        "DA:4,1",
        "end_of_record",
      ].join("\n");

      const fileMap = parseLcov(sampleLcov, TEST_SCRATCH_DIR);
      const summary = buildCoverageSummary(fileMap);
      const html = generateInteractiveHtml(fileMap, summary, TEST_SCRATCH_DIR);

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("Skills Test Coverage");
      expect(html).toContain("src/sample.ts");
      expect(html).toContain("DATA");
      expect(html).toContain("miss-chip");
    });

    test("writeInteractiveHtml writes index.html file", () => {
      const sampleLcov = "SF:src/a.ts\nLF:5\nLH:5\nend_of_record";
      const fileMap = parseLcov(sampleLcov, TEST_SCRATCH_DIR);
      const summary = buildCoverageSummary(fileMap);

      const htmlPath = writeInteractiveHtml(fileMap, summary, TEST_SCRATCH_DIR, "cov");
      expect(existsSync(htmlPath)).toBe(true);
      expect(readFileSync(htmlPath, "utf-8")).toContain("<!DOCTYPE html>");
    });
  });

  describe("unified entrypoint processCoverageArtifacts", () => {
    test("returns lcovExists: false when lcov.info is missing", () => {
      const res = processCoverageArtifacts(TEST_SCRATCH_DIR, "nonexistent");
      expect(res.lcovExists).toBe(false);
      expect(res.filesCount).toBe(0);
      expect(res.totalPct).toBe(0);
    });

    test("orchestrates all 3 artifacts when lcov.info is present", () => {
      const covDir = join(TEST_SCRATCH_DIR, "coverage");
      mkdirSync(covDir, { recursive: true });
      const sampleLcov = "SF:src/test.ts\nLF:10\nLH:10\nFNF:1\nFNH:1\nend_of_record";
      writeFileSync(join(covDir, "lcov.info"), sampleLcov, "utf-8");

      const res = processCoverageArtifacts(TEST_SCRATCH_DIR, "coverage");
      expect(res.lcovExists).toBe(true);
      expect(res.filesCount).toBe(1);
      expect(res.totalPct).toBe(100);

      expect(existsSync(join(covDir, "coverage-summary.json"))).toBe(true);
      expect(existsSync(join(covDir, "REPORT.md"))).toBe(true);
      expect(existsSync(join(covDir, "index.html"))).toBe(true);
    });
  });
});
