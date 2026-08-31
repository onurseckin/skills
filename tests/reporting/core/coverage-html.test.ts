import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildHtmlDocument,
  extractCoverageFileData,
  generateInteractiveHtml,
  getClientScript,
  getHtmlStyles,
  writeInteractiveHtml,
} from "../../../scripts/testing/reporting/html/index.ts";
import { getClientScriptHelpers } from "../../../scripts/testing/reporting/html/client-script-helpers.ts";
import { getCodeViewerStyles } from "../../../scripts/testing/reporting/html/styles-code-viewer.ts";
import {
  buildCoverageSummary,
  createMetricItem,
} from "../../../scripts/testing/reporting/index.ts";
import type {
  CoverageSummary,
  FileCoverageMetric,
} from "../../../scripts/testing/reporting/types.ts";

export const coverageHtmlSuiteName = "Coverage HTML Interactive Report Generation & Templating";

describe(coverageHtmlSuiteName, () => {
  const tmpRoot = join(process.cwd(), ".tmp-test-reporting-suite-html");

  function cleanupTmp(): void {
    if (existsSync(tmpRoot)) {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  }

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
      expect(doc).toContain("<title>Test Coverage & Runtime Dashboard - @onurseckin/skills</title>");
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

      const outPath2 = writeInteractiveHtml(fileMap, summary, tmpRoot, "cov-html");
      expect(outPath2).toBe(outPath);

      cleanupTmp();
    });
  });
});
