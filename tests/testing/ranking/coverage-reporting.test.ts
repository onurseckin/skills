import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  buildCoverageSummary,
  buildHtmlDocument,
  buildMarkdownReport,
  calculatePct,
  computeIsMain,
  createMetricItem,
  extractCoverageFileData,
  generateInteractiveHtml,
  getClientScript,
  getHtmlStyles,
  main,
  parseLcov,
  processCoverageArtifacts,
  writeInteractiveHtml,
  writeMarkdownReport,
  writeSummaryJson,
  type CoverageSummary,
} from "../../../scripts/testing/reporting/index.ts";

const TEST_SCRATCH_DIR = "/virtual/coverage-scratch/coverage-reporting-test-unit";

let vfs: VirtualMemoryFS;
let session: VirtualFSSession | undefined;

describe("Coverage Reporting Modules", () => {
  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    vfs.mkdirSync(TEST_SCRATCH_DIR, { recursive: true });
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    if (session) {
      session.cleanup();
      session = undefined;
    }
  });

  describe("types and metric helpers", () => {
    test("calculatePct handles zero and negative totals", () => {
      expect(calculatePct(0, 0)).toBe(100);
      expect(calculatePct(5, 0)).toBe(100);
      expect(calculatePct(5, -1)).toBe(100);
      expect(calculatePct(50, 100)).toBe(50);
      expect(calculatePct(1, 3)).toBe(33.33);
    });

    test("createMetricItem constructs MetricItem correctly", () => {
      const metric = createMetricItem(8, 10);
      expect(metric.total).toBe(10);
      expect(metric.covered).toBe(8);
      expect(metric.skipped).toBe(0);
      expect(metric.pct).toBe(80);
    });

    test("computeIsMain detects entry path correctly", () => {
      expect(computeIsMain(true)).toBe(true);
      expect(computeIsMain(false, undefined)).toBe(false);
      expect(computeIsMain(false, "/repo/scripts/testing/reporting/index.ts")).toBe(true);
      expect(computeIsMain(false, "/repo/scripts/testing/reporting")).toBe(true);
      expect(computeIsMain(false, "/repo/other.ts")).toBe(false);
    });
  });

  describe("lcov-parser", () => {
    test("parseLcov parses valid LCOV records and handles empty / malformed content", () => {
      const sample = [
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
        "DA:0,0",
        "end_of_record",
      ].join("\n");
      const fileMap = parseLcov(sample, TEST_SCRATCH_DIR);
      expect(fileMap.size).toBe(1);
      const metric = fileMap.get("src/foo.ts");
      expect(metric?.lines.pct).toBe(80);
      expect(metric?.uncoveredLines).toEqual([3, 5]);

      expect(parseLcov("   \n\n", TEST_SCRATCH_DIR).size).toBe(0);
      const fallbackMap = parseLcov("SF:src/empty.ts\nFNF:\nLF:\nend_of_record", TEST_SCRATCH_DIR);
      expect(fallbackMap.get("src/empty.ts")?.lines.total).toBe(0);
    });
  });

  describe("summary-reporter", () => {
    test("buildCoverageSummary aggregates metrics across files", () => {
      const sample =
        "SF:src/a.ts\nLF:10\nLH:10\nend_of_record\nSF:src/b.ts\nLF:10\nLH:5\nend_of_record";
      const fileMap = parseLcov(sample, TEST_SCRATCH_DIR);
      const summary = buildCoverageSummary(fileMap);
      expect(summary.total?.lines.total).toBe(20);
      expect(summary.total?.lines.covered).toBe(15);
      expect(summary.total?.lines.pct).toBe(75);
    });

    test("writeSummaryJson handles disk write, writeToDisk:false bypass, and skips unchanged writes", () => {
      const sample = "SF:src/a.ts\nLF:5\nLH:5\nend_of_record";
      const summary = buildCoverageSummary(parseLcov(sample, TEST_SCRATCH_DIR));

      // 1. In-memory bypass
      const memPath = writeSummaryJson(summary, TEST_SCRATCH_DIR, "cov-mem", {
        writeToDisk: false,
      });
      expect(existsSync(memPath)).toBe(false);

      // 2. Normal write
      const summaryPath = writeSummaryJson(summary, TEST_SCRATCH_DIR, "cov-disk");
      expect(existsSync(summaryPath)).toBe(true);

      // 3. Skip unchanged write
      const writeSpy = spyOn(vfs, "writeFileSync");
      try {
        const cachedPath = writeSummaryJson(summary, TEST_SCRATCH_DIR, "cov-disk");
        expect(cachedPath).toBe(summaryPath);
        expect(writeSpy).not.toHaveBeenCalled();
      } finally {
        writeSpy.mockRestore();
      }
    });
  });

  describe("markdown-reporter", () => {
    test("buildMarkdownReport and writeMarkdownReport generate markdown correctly", () => {
      const sample =
        "SF:src/a.ts\nLF:10\nLH:8\nDA:1,0\nend_of_record\nSF:src/b.ts\nLF:10\nLH:1\nDA:1,0\nend_of_record";
      const fileMap = parseLcov(sample, TEST_SCRATCH_DIR);
      const summary = buildCoverageSummary(fileMap);
      const md = buildMarkdownReport(fileMap, summary);
      expect(md).toContain("# Repository Unit Test Coverage Report");
      expect(md).toContain("80% (8/10)");

      const emptySummary: CoverageSummary = {};
      expect(buildMarkdownReport(new Map(), emptySummary)).toContain("PASS");

      const reportPath = writeMarkdownReport(fileMap, summary, TEST_SCRATCH_DIR, "cov-md");
      expect(existsSync(reportPath)).toBe(true);
    });
  });

  describe("html-reporter", () => {
    test("generates styles, scripts, html document, and interactive dashboard", () => {
      const styles = getHtmlStyles();
      expect(styles).toContain(":root");
      expect(styles).toContain(".cov-bar-track");
      expect(styles).toContain(".badge {");
      expect(styles).toContain("border-radius: 4px;");
      expect(styles).toContain(".badge-pass");
      expect(styles).toContain(".badge-warn");
      expect(styles).toContain(".badge-fail");
      expect(styles).toContain(".badge-p50");
      expect(styles).toContain(".badge-p90");
      expect(styles).toContain(".badge-pnormal");
      expect(styles).toContain(".badge-cat-error-handling");
      expect(styles).toContain(".miss-chip");
      expect(getClientScript("{}")).toContain("const DATA = {}");
      expect(getClientScript("{}")).toContain("renderCoverageBar");
      expect(buildHtmlDocument("/* css */", "/* js */")).toContain("<!DOCTYPE html>");

      const dummyFile = join(TEST_SCRATCH_DIR, "src/sample.ts");
      vfs.mkdirSync(join(TEST_SCRATCH_DIR, "src"), { recursive: true });
      vfs.writeFileSync(dummyFile, "const a = 1;\nconst b = 2;", "utf-8");

      const sample =
        "SF:src/sample.ts\nLF:2\nLH:1\nDA:1,1\nDA:2,0\nend_of_record\nSF:src/missing.ts\nLF:1\nLH:0\nDA:1,0\nend_of_record";
      const fileMap = parseLcov(sample, TEST_SCRATCH_DIR);
      const filesData = extractCoverageFileData(fileMap, TEST_SCRATCH_DIR);
      expect(filesData.length).toBe(2);
      expect(filesData[0]?.sourceLines?.length).toBe(2);
      expect(filesData[1]?.sourceLines).toBeUndefined();

      const summary = buildCoverageSummary(fileMap);
      const html = generateInteractiveHtml(fileMap, summary, TEST_SCRATCH_DIR);
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("btn-reset-filters");
      expect(html).toContain("resetMasterFilters()");
      expect(html).toContain("filter-perfect");
      expect(html).toContain("filter-miss");
      expect(html).toContain("filter-deficits");
      expect(html).toContain("filter-slow");
      expect(html).toContain("renderRankedTreeNodes");
      expect(html).toContain("collectMatchingNodes");

      const htmlPath = writeInteractiveHtml(fileMap, summary, TEST_SCRATCH_DIR, "cov-html");
      expect(existsSync(htmlPath)).toBe(true);
    });

    test("filter bar navbar styling contains overflow and styles reset button", () => {
      const styles = getHtmlStyles();
      expect(styles).toContain(".controls-bar");
      expect(styles).toContain("flex-wrap: wrap;");
      expect(styles).toContain("overflow: hidden;");
      expect(styles).toContain(".reset-btn");
      expect(styles).toContain(".filters-group");
    });

    test("client scripts support filter metric ranking and single-click reset", () => {
      const script = getClientScript("{}");
      expect(script).toContain("function setMasterFilter(f)");
      expect(script).toContain("function resetMasterFilters()");
      expect(script).toContain('masterFilter = "all"');
      expect(script).toContain('masterSearch = ""');
      expect(script).toContain('viewMode = "tree"');
      expect(script).toContain("renderRankedTreeNodes()");
      expect(script).toContain("sortUnifiedItems(");
    });

    test("client scripts and styles support full-row click interactions and hover states", () => {
      const script = getClientScript("{}");
      expect(script).toContain("function escapeJs(str)");
      expect(script).toContain("function openCodeViewer(path, lineNoOrEvt)");
      expect(script).toContain("function toggleFolderRow(path, evt)");
      expect(script).toContain("openCodeViewer(");
      expect(script).toContain("toggleFolderRow(");
      expect(script).toContain("event.stopPropagation()");

      const styles = getHtmlStyles();
      expect(styles).toContain("rgba(255, 255, 255, 0.03)");
      expect(styles).toContain("cursor: pointer;");
    });

    test("client scripts and styles render structured deficit pills and clickable missed line ranges", () => {
      const script = getClientScript("{}");
      expect(script).toContain("function renderDeficitCell(n)");
      expect(script).toContain("function getUncoveredRanges(n)");
      expect(script).toContain("deficit-pill-dir");
      expect(script).toContain("deficit-pill-file");
      expect(script).toContain("deficit-subtle-cats");
      expect(script).toContain("miss-range-chip");

      const styles = getHtmlStyles();
      expect(styles).toContain(".deficit-pill");
      expect(styles).toContain(".deficit-pill-dir");
      expect(styles).toContain(".deficit-pill-file");
      expect(styles).toContain(".deficit-subtle-cats");
      expect(styles).toContain(".miss-range-chip");
    });

    test("flat file list mode correctly formats totals, sorting, and telemetry metrics", () => {
      const script = getClientScript("{}");
      expect(script).toContain("function renderFlatFiles()");
      expect(script).toContain("function sortUnifiedItems(");
      expect(script).toContain("function getNodeMetricVal(");
      expect(script).toContain('col === "lines"');
      expect(script).toContain('col === "funcs"');
      expect(script).toContain('col === "duration"');
      expect(script).toContain('col === "deficits"');
      expect(script).toContain('col === "path"');
      expect(script).toContain("Displaying ");
      expect(script).toContain(" of ");
      expect(script).toContain(" files (");
      expect(script).toContain(" unit tests)");
      expect(script).toContain("badge-p50");
      expect(script).toContain("badge-p90");
      expect(script).toContain("badge-pnormal");
    });

    test("flat file list mode implements 100-item in-memory pagination and obsidian controls", () => {
      const script = getClientScript("{}");
      expect(script).toContain("let flatCurrentPage = 1;");
      expect(script).toContain("let flatPageSize = 100;");
      expect(script).toContain("function changeFlatPage(page)");
      expect(script).toContain("function renderFlatPagination(totalItems)");
      expect(script).toContain("flatCurrentPage * flatPageSize");
      expect(script).toContain("changeFlatPage(");
      expect(script).toContain("flat-pagination-bar");

      const styles = getHtmlStyles();
      expect(styles).toContain(".flat-pagination-bar");
      expect(styles).toContain(".flat-page-btn");
      expect(styles).toContain(".flat-page-pill");
    });
  });
});
