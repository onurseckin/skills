import { describe, expect, test } from "bun:test";
import {
  buildMarkdownReport,
  calculateParetoThreshold,
  computeRuntimeSummary,
  generateInteractiveHtml,
  parseDurationToMs,
  parseTestRuntimeOutput,
  processCoverageArtifacts,
  sliceRuntimePagination,
  type FileCoverageMetric,
  type TestFileRuntime,
} from "../../scripts/testing/reporting/index.ts";

describe("Test Runtime Telemetry & Pareto Ranking", () => {
  describe("parseDurationToMs", () => {
    test("parses ms, µs, us, s, and plain numbers correctly", () => {
      expect(parseDurationToMs("150ms")).toBe(150);
      expect(parseDurationToMs("150.55ms")).toBe(150.55);
      expect(parseDurationToMs("2.5s")).toBe(2500);
      expect(parseDurationToMs("500µs")).toBe(0.5);
      expect(parseDurationToMs("1000us")).toBe(1);
      expect(parseDurationToMs("42")).toBe(42);
      expect(parseDurationToMs("invalid")).toBe(0);
    });
  });

  describe("calculateParetoThreshold", () => {
    test("handles empty and zero duration file lists", () => {
      const empty = calculateParetoThreshold([], 50);
      expect(empty.fileCount).toBe(0);
      expect(empty.cumulativeDurationMs).toBe(0);

      const zeroDur: TestFileRuntime[] = [
        { file: "a.test.ts", durationMs: 0, percentage: 0 },
        { file: "b.test.ts", durationMs: 0, percentage: 0 },
      ];
      const res = calculateParetoThreshold(zeroDur, 50);
      expect(res.fileCount).toBe(2);
    });

    test("computes 50% and 90% Pareto concentration accurately", () => {
      const files: TestFileRuntime[] = [
        { file: "heavy.test.ts", durationMs: 600, percentage: 60 },
        { file: "medium.test.ts", durationMs: 300, percentage: 30 },
        { file: "light1.test.ts", durationMs: 50, percentage: 5 },
        { file: "light2.test.ts", durationMs: 50, percentage: 5 },
      ];

      const p50 = calculateParetoThreshold(files, 50);
      expect(p50.fileCount).toBe(1);
      expect(p50.files[0]?.file).toBe("heavy.test.ts");
      expect(p50.cumulativeDurationMs).toBe(600);

      const p90 = calculateParetoThreshold(files, 90);
      expect(p90.fileCount).toBe(2);
      expect(p90.cumulativeDurationMs).toBe(900);
    });
  });

  describe("computeRuntimeSummary", () => {
    test("calculates averages, odd/even medians, percentages, and slowest file", () => {
      const oddFiles: TestFileRuntime[] = [
        { file: "f1.test.ts", durationMs: 100, percentage: 0 },
        { file: "f2.test.ts", durationMs: 200, percentage: 0 },
        { file: "f3.test.ts", durationMs: 300, percentage: 0 },
      ];
      const summaryOdd = computeRuntimeSummary(
        oddFiles,
        "2026-08-31T00:00:00Z",
        "2026-08-31T00:00:01Z",
        600,
      );
      expect(summaryOdd.totalFiles).toBe(3);
      expect(summaryOdd.avgDurationMs).toBe(200);
      expect(summaryOdd.medianDurationMs).toBe(200);
      expect(summaryOdd.slowestFile?.file).toBe("f3.test.ts");
      expect(summaryOdd.files[0]?.percentage).toBe(50);

      const evenFiles: TestFileRuntime[] = [
        { file: "f1.test.ts", durationMs: 10, percentage: 0 },
        { file: "f2.test.ts", durationMs: 20, percentage: 0 },
        { file: "f3.test.ts", durationMs: 30, percentage: 0 },
        { file: "f4.test.ts", durationMs: 40, percentage: 0 },
      ];
      const summaryEven = computeRuntimeSummary(evenFiles);
      expect(summaryEven.totalFiles).toBe(4);
      expect(summaryEven.avgDurationMs).toBe(25);
      expect(summaryEven.medianDurationMs).toBe(25);
    });

    test("handles empty files array gracefully", () => {
      const empty = computeRuntimeSummary([]);
      expect(empty.totalFiles).toBe(0);
      expect(empty.avgDurationMs).toBe(0);
      expect(empty.medianDurationMs).toBe(0);
      expect(empty.slowestFile).toBeUndefined();
    });
  });

  describe("parseTestRuntimeOutput", () => {
    test("parses multi-file Bun test output with ANSI codes and summary line", () => {
      const output = `
\u001b[1mtests/unit/core.test.ts:\u001b[0m
(pass) core > initialize [10.50ms]
(pass) core > execute [20.50ms]

\u001b[1mtests/unit/runner.test.ts:\u001b[0m
(pass) runner > start [50.00ms]
(fail) runner > timeout [150.00ms]

 4 pass
 1 fail
Ran 5 tests across 2 files. [250.00ms]
      `;

      const summary = parseTestRuntimeOutput(output);
      expect(summary.totalFiles).toBe(2);
      expect(summary.totalDurationMs).toBe(250);
      expect(summary.files[0]?.file).toBe("tests/unit/runner.test.ts");
      expect(summary.files[0]?.durationMs).toBe(200);
      expect(summary.files[0]?.passed).toBe(false);
      expect(summary.files[1]?.file).toBe("tests/unit/core.test.ts");
      expect(summary.files[1]?.durationMs).toBe(31);
      expect(summary.files[1]?.passed).toBe(true);
    });

    test("handles output with no test files", () => {
      const summary = parseTestRuntimeOutput("No tests found");
      expect(summary.totalFiles).toBe(0);
      expect(summary.totalDurationMs).toBe(0);
    });
  });

  describe("sliceRuntimePagination", () => {
    test("slices 50-item pages and clamps page boundaries", () => {
      const items = Array.from({ length: 125 }, (_, i) => ({
        file: `test-${i + 1}.test.ts`,
        durationMs: i + 1,
        percentage: 1,
      }));

      // Page 1
      const p1 = sliceRuntimePagination(items, 1, 50);
      expect(p1.page).toBe(1);
      expect(p1.totalPages).toBe(3);
      expect(p1.items.length).toBe(50);
      expect(p1.hasPrev).toBe(false);
      expect(p1.hasNext).toBe(true);
      expect(p1.startIndex).toBe(0);
      expect(p1.endIndex).toBe(50);

      // Page 2
      const p2 = sliceRuntimePagination(items, 2, 50);
      expect(p2.page).toBe(2);
      expect(p2.items.length).toBe(50);
      expect(p2.hasPrev).toBe(true);
      expect(p2.hasNext).toBe(true);

      // Page 3
      const p3 = sliceRuntimePagination(items, 3, 50);
      expect(p3.page).toBe(3);
      expect(p3.items.length).toBe(25);
      expect(p3.hasPrev).toBe(true);
      expect(p3.hasNext).toBe(false);

      // Out of bounds clamp
      const pOver = sliceRuntimePagination(items, 999, 50);
      expect(pOver.page).toBe(3);
      const pUnder = sliceRuntimePagination(items, -5, 50);
      expect(pUnder.page).toBe(1);
    });
  });

  describe("Artifact Rendering with Runtime Telemetry", () => {
    test("buildMarkdownReport formats Pareto KPI cards and Top 10 table", () => {
      const fileMap = new Map<string, FileCoverageMetric>();
      const files: TestFileRuntime[] = Array.from({ length: 12 }, (_, i) => ({
        file: `tests/file-${i + 1}.test.ts`,
        durationMs: (12 - i) * 10,
        percentage: 10,
        passed: i !== 1,
      }));
      const runtime = computeRuntimeSummary(files);
      const summary = {
        total: {
          lines: { total: 100, covered: 100, skipped: 0, pct: 100 },
          statements: { total: 100, covered: 100, skipped: 0, pct: 100 },
          functions: { total: 10, covered: 10, skipped: 0, pct: 100 },
        },
      };

      const md = buildMarkdownReport(fileMap, summary, runtime);
      expect(md).toContain("## ⚡ Test Runtime Performance & Telemetry");
      expect(md).toContain("### 🐢 Top 10 Slowest Test Files");
      expect(md).toContain("🎯 Top 50% Concentration");
      expect(md).toContain("📈 Top 90% Concentration");
      expect(md).toContain("`tests/file-1.test.ts`");
      expect(md).toContain("🔴 FAIL");
    });

    test("generateInteractiveHtml includes runtime data payload and tab elements", () => {
      const fileMap = new Map<string, FileCoverageMetric>();
      const runtime = computeRuntimeSummary([
        { file: "tests/a.test.ts", durationMs: 120, percentage: 100, passed: true },
      ]);
      const summary = {
        total: {
          lines: { total: 50, covered: 50, skipped: 0, pct: 100 },
          statements: { total: 50, covered: 50, skipped: 0, pct: 100 },
          functions: { total: 5, covered: 5, skipped: 0, pct: 100 },
        },
      };

      const html = generateInteractiveHtml(fileMap, summary, process.cwd(), runtime);
      expect(html).toContain('id="tab-runtime"');
      expect(html).toContain('id="runtime-section"');
      expect(html).toContain("val-rt-total");
      expect(html).toContain("val-rt-p50");
      expect(html).toContain('"file":"tests/a.test.ts"');
    });

    test("processCoverageArtifacts parses testOutput in pure in-memory mode", () => {
      const lcovContent = "SF:src/math.ts\nLF:10\nLH:10\nend_of_record";
      const testOutput =
        "tests/unit/math.test.ts:\n(pass) math > add [15.00ms]\nRan 1 test across 1 file. [25.00ms]";

      const res = processCoverageArtifacts(process.cwd(), "coverage", {
        writeToDisk: false,
        lcovContent,
        testOutput,
      });

      expect(res.lcovExists).toBe(true);
      expect(res.totalPct).toBe(100);
      expect(res.runtime).toBeDefined();
      expect(res.runtime?.totalFiles).toBe(1);
      expect(res.runtime?.slowestFile?.file).toBe("tests/unit/math.test.ts");
    });
  });
});
