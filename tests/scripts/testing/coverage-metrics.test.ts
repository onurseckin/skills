/**
 * @file coverage-metrics.test.ts
 * Unit tests for coverage metrics parsing and markdown reporting with 100% in-memory virtual filesystem mocking.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import {
  createVirtualFSSession,
  type VirtualFSSession,
  VirtualMemoryFS,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  buildCoverageSummary,
  buildMarkdownReport,
  calculatePct,
  createMetricItem,
  parseLcov,
  writeMarkdownReport,
  writeSummaryJson,
  type CoverageSummary,
  type FileCoverageMetric,
} from "../../../scripts/testing/reporting/index.ts";

describe("Coverage Metrics and Markdown Reporting (in-memory virtual)", () => {
  const testScratchDir = "/virtual/cov-met-test";
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
    mkdirSync(testScratchDir, { recursive: true });
  });

  afterEach(() => {
    session.cleanup();
  });

  describe("types and metric helpers", () => {
    test("calculatePct handles zero total gracefully", () => {
      expect(calculatePct(0, 0)).toBe(100);
      expect(calculatePct(5, 0)).toBe(100);
      expect(calculatePct(5, -1)).toBe(100);
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
        "DA:0,0",
        "end_of_record",
      ].join("\n");

      const fileMap = parseLcov(sampleLcov, testScratchDir);
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

    test("parseLcov resolves absolute paths relative to rootDir", () => {
      const absPath = `${testScratchDir}/src/bar.ts`;
      const sampleLcov = `SF:${absPath}\nLF:5\nLH:5\nend_of_record`;
      const fileMap = parseLcov(sampleLcov, testScratchDir);
      expect(fileMap.has("src/bar.ts")).toBe(true);
    });

    test("parseLcov handles invalid records and empty content gracefully", () => {
      const emptyMap = parseLcov("", testScratchDir);
      expect(emptyMap.size).toBe(0);

      const garbage = "some garbage text\nwithout SF tags\nend_of_record";
      const garbageMap = parseLcov(garbage, testScratchDir);
      expect(garbageMap.size).toBe(0);
    });
  });

  describe("summary-reporter", () => {
    test("buildCoverageSummary aggregates metrics across multiple files correctly", () => {
      const sampleLcov = [
        "SF:src/a.ts",
        "FNF:2",
        "FNH:2",
        "LF:10",
        "LH:10",
        "DA:1,1",
        "end_of_record",
        "SF:src/b.ts",
        "FNF:2",
        "FNH:0",
        "LF:10",
        "LH:0",
        "DA:1,0",
        "end_of_record",
      ].join("\n");

      const fileMap = parseLcov(sampleLcov, testScratchDir);
      const summary = buildCoverageSummary(fileMap);

      expect(summary.total).toBeDefined();
      expect(summary.total?.lines.total).toBe(20);
      expect(summary.total?.lines.covered).toBe(10);
      expect(summary.total?.lines.pct).toBe(50);
      expect(summary.total?.functions.total).toBe(4);
      expect(summary.total?.functions.covered).toBe(2);
      expect(summary.total?.functions.pct).toBe(50);

      expect(summary["src/a.ts"]).toBeDefined();
      expect(summary["src/a.ts"]?.lines.pct).toBe(100);
      expect(summary["src/b.ts"]).toBeDefined();
      expect(summary["src/b.ts"]?.lines.pct).toBe(0);
    });

    test("writeSummaryJson outputs valid JSON file and creates directory if missing", () => {
      const sampleLcov = "SF:src/a.ts\nLF:10\nLH:10\nend_of_record";
      const fileMap = parseLcov(sampleLcov, testScratchDir);
      const summary = buildCoverageSummary(fileMap);

      const outPath = writeSummaryJson(summary, testScratchDir, "nested/coverage");
      expect(existsSync(outPath)).toBe(true);

      const content = JSON.parse(readFileSync(outPath, "utf-8"));
      expect(content.total.lines.pct).toBe(100);
    });
  });

  describe("markdown-reporter", () => {
    test("buildMarkdownReport formats tables and status badges", () => {
      const sampleLcov = [
        "SF:src/good.ts",
        "LF:10",
        "LH:10",
        "end_of_record",
        "SF:src/warn.ts",
        "LF:10",
        "LH:8",
        "DA:1,1",
        "DA:2,0",
        "end_of_record",
        "SF:src/bad.ts",
        "LF:10",
        "LH:1",
        "DA:1,0",
        "DA:2,0",
        "DA:3,0",
        "DA:4,0",
        "DA:5,0",
        "DA:6,0",
        "DA:7,0",
        "DA:8,0",
        "DA:9,0",
        "DA:10,0",
        "DA:11,0",
        "DA:12,0",
        "end_of_record",
      ].join("\n");

      const fileMap = parseLcov(sampleLcov, testScratchDir);
      const summary = buildCoverageSummary(fileMap);
      const markdown = buildMarkdownReport(fileMap, summary);

      expect(markdown).toContain("# Repository Unit Test Coverage Report");
      expect(markdown).toContain("`src/good.ts`");
      expect(markdown).toContain("`src/warn.ts`");
      expect(markdown).toContain("`src/bad.ts`");
      expect(markdown).toContain("100% (10/10)");
      expect(markdown).toContain("80% (8/10)");
      expect(markdown).toContain("10% (1/10)");
      expect(markdown).toContain("(+2 more)");
    });

    test("buildMarkdownReport handles empty summary.total fallback", () => {
      const emptyMap = new Map<string, FileCoverageMetric>();
      const emptySummary: CoverageSummary = {};
      const markdown = buildMarkdownReport(emptyMap, emptySummary);
      expect(markdown).toContain("# Repository Unit Test Coverage Report");
      expect(markdown).toContain("PASS");
    });

    test("writeMarkdownReport writes REPORT.md file and creates directory if missing", () => {
      const sampleLcov = "SF:src/a.ts\nLF:5\nLH:5\nend_of_record";
      const fileMap = parseLcov(sampleLcov, testScratchDir);
      const summary = buildCoverageSummary(fileMap);

      const reportPath = writeMarkdownReport(fileMap, summary, testScratchDir, "nested/cov");
      expect(existsSync(reportPath)).toBe(true);
      expect(readFileSync(reportPath, "utf-8")).toContain("# Repository Unit Test Coverage Report");
    });
  });
});
