import { describe, expect, test } from "bun:test";
import {
  buildUnifiedHierarchy,
  extractCoverageFileData,
  findMatchingSourceFile,
  findMatchingTestFile,
  generateInteractiveHtml,
  getDeficitStyles,
  getHtmlStyles,
  getUnifiedStyles,
  type CoverageSummary,
  type FileCoverageMetric,
  type FileDetailData,
  type TestRuntimeSummary,
} from "../../../scripts/testing/reporting/index.ts";

function createMockCoverageMetric(
  file: string,
  linesCovered = 10,
  linesTotal = 10,
  uncoveredLines: number[] = [],
): FileCoverageMetric {
  const lineHits = new Map<number, number>();
  for (let i = 1; i <= linesTotal; i++) {
    if (!uncoveredLines.includes(i)) {
      lineHits.set(i, 1);
    } else {
      lineHits.set(i, 0);
    }
  }
  const pct = linesTotal > 0 ? Math.round((linesCovered / linesTotal) * 10000) / 100 : 100;
  return {
    file,
    lines: { total: linesTotal, covered: linesCovered, skipped: 0, pct },
    statements: { total: linesTotal, covered: linesCovered, skipped: 0, pct },
    functions: {
      total: 2,
      covered: linesCovered === linesTotal ? 2 : 1,
      skipped: 0,
      pct: linesCovered === linesTotal ? 100 : 50,
    },
    uncoveredLines,
    lineHits,
  };
}

function createSampleRuntime(): TestRuntimeSummary {
  const test1 = {
    file: "tests/testing/runner/streaming-runner.test.ts",
    durationMs: 500,
    percentage: 50,
    passed: true,
    testCount: 5,
  };
  const test2 = {
    file: "tests/testing/runner/arg-parser.test.ts",
    durationMs: 300,
    percentage: 30,
    passed: true,
    testCount: 3,
  };
  const test3 = {
    file: "tests/testing/locks/test-mutex.test.ts",
    durationMs: 200,
    percentage: 20,
    passed: false,
    testCount: 2,
  };
  return {
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
    totalDurationMs: 1000,
    totalFiles: 3,
    avgDurationMs: 333.33,
    medianDurationMs: 300,
    slowestFile: test1,
    files: [test1, test2, test3],
    pareto50: { percentage: 50, fileCount: 1, cumulativeDurationMs: 500, files: [test1] },
    pareto90: { percentage: 90, fileCount: 2, cumulativeDurationMs: 800, files: [test1, test2] },
  };
}

describe("Wave 4 & 5 Unified Hierarchy & Dashboard", () => {
  describe("findMatchingTestFile & findMatchingSourceFile", () => {
    const testFiles = [
      "tests/testing/runner/streaming-runner.test.ts",
      "tests/testing/runner/arg-parser.test.ts",
      "tests/testing/locks/test-mutex.spec.ts",
    ];
    const sourceFiles = [
      "scripts/testing/runner/streaming-runner.ts",
      "scripts/testing/runner/arg-parser.ts",
      "scripts/testing/test-mutex.ts",
    ];

    test("finds direct relative path match and stem matches", () => {
      expect(findMatchingTestFile("scripts/testing/runner/streaming-runner.ts", testFiles)).toBe(
        "tests/testing/runner/streaming-runner.test.ts",
      );
      expect(findMatchingTestFile("scripts/testing/runner/arg-parser.ts", testFiles)).toBe(
        "tests/testing/runner/arg-parser.test.ts",
      );
      expect(findMatchingTestFile("scripts/testing/test-mutex.ts", testFiles)).toBe(
        "tests/testing/locks/test-mutex.spec.ts",
      );
    });

    test("findMatchingSourceFile matches test file to source file symmetrically", () => {
      expect(
        findMatchingSourceFile("tests/testing/runner/streaming-runner.test.ts", sourceFiles),
      ).toBe("scripts/testing/runner/streaming-runner.ts");
      expect(findMatchingSourceFile("tests/testing/locks/test-mutex.spec.ts", sourceFiles)).toBe(
        "scripts/testing/test-mutex.ts",
      );
    });

    test("returns undefined for empty candidates or unmatchable paths", () => {
      expect(findMatchingTestFile("", testFiles)).toBeUndefined();
      expect(findMatchingTestFile("scripts/unknown.ts", [])).toBeUndefined();
      expect(findMatchingSourceFile("", sourceFiles)).toBeUndefined();
    });
  });

  describe("extractCoverageFileData with Test Telemetry", () => {
    test("annotates source files with matching test metrics and pareto classes", () => {
      const fileMap = new Map<string, FileCoverageMetric>([
        [
          "scripts/testing/runner/streaming-runner.ts",
          createMockCoverageMetric("scripts/testing/runner/streaming-runner.ts", 10, 10),
        ],
        [
          "scripts/testing/runner/arg-parser.ts",
          createMockCoverageMetric("scripts/testing/runner/arg-parser.ts", 8, 10, [9, 10]),
        ],
        [
          "scripts/testing/locks/test-mutex.ts",
          createMockCoverageMetric("scripts/testing/locks/test-mutex.ts", 5, 10, [6, 7, 8, 9, 10]),
        ],
      ]);
      const runtime = createSampleRuntime();
      const files = extractCoverageFileData(fileMap, process.cwd(), runtime);

      expect(files).toHaveLength(3);
      const runnerFile = files.find((f) => f.path === "scripts/testing/runner/streaming-runner.ts");
      expect(runnerFile?.testDurationMs).toBe(500);
      expect(runnerFile?.testPassed).toBe(true);
      expect(runnerFile?.paretoClass).toBe("p50");

      const argParserFile = files.find((f) => f.path === "scripts/testing/runner/arg-parser.ts");
      expect(argParserFile?.paretoClass).toBe("p90");

      const mutexFile = files.find((f) => f.path === "scripts/testing/locks/test-mutex.ts");
      expect(mutexFile?.testPassed).toBe(false);
    });
  });

  describe("buildUnifiedHierarchy", () => {
    test("builds nested tree structure and aggregates metric counts recursively", () => {
      const files: FileDetailData[] = [
        {
          path: "scripts/testing/runner/streaming-runner.ts",
          linesPct: 100,
          statementsPct: 100,
          funcsPct: 100,
          linesCovered: 50,
          linesTotal: 50,
          statementsCovered: 50,
          statementsTotal: 50,
          funcsCovered: 5,
          funcsTotal: 5,
          uncoveredLines: [],
          testDurationMs: 400,
          testPassed: true,
          testCount: 4,
          paretoClass: "p50",
        },
      ];

      const tree = buildUnifiedHierarchy(files);
      expect(tree.type).toBe("dir");
      expect(tree.lines.total).toBe(50);
      expect(tree.lines.covered).toBe(50);
      expect(tree.testDurationMs).toBe(400);
      expect(tree.children?.length).toBeGreaterThan(0);
    });

    test("handles empty file list gracefully", () => {
      const tree = buildUnifiedHierarchy([]);
      expect(tree.type).toBe("dir");
      expect(tree.lines.total).toBe(0);
      expect(tree.lines.covered).toBe(0);
      expect(tree.lines.pct).toBe(100);
      expect(tree.children).toEqual([]);
    });
  });

  describe("HTML Dashboard Integration with 4 Tabs & Obsidian Aesthetics", () => {
    test("generateInteractiveHtml embeds 4 tabs, KPIs, and deficit data", () => {
      const fileMap = new Map<string, FileCoverageMetric>([
        ["scripts/testing/foo.ts", createMockCoverageMetric("scripts/testing/foo.ts", 20, 20)],
      ]);
      const summary: CoverageSummary = {
        total: {
          lines: { total: 20, covered: 20, skipped: 0, pct: 100 },
          statements: { total: 20, covered: 20, skipped: 0, pct: 100 },
          functions: { total: 2, covered: 2, skipped: 0, pct: 100 },
        },
      };
      const runtime = createSampleRuntime();
      const html = generateInteractiveHtml(fileMap, summary, process.cwd(), runtime);

      expect(html).toContain('id="tab-coverage"');
      expect(html).toContain('id="tab-runtime"');
      expect(html).toContain('id="tab-unified"');
      expect(html).toContain('id="tab-deficits"');
      expect(html).toContain('id="deficits-section"');
      expect(html).toContain("metric-progress-track");
      expect(html).toContain("unified-tree-table");
      expect(html).toContain("deficit-kpi-card");
    });

    test("styles include Obsidian Dark-Mode glows, scrollbars, and deficit CSS", () => {
      const htmlStyles = getHtmlStyles();
      const defStyles = getDeficitStyles();
      expect(htmlStyles).toContain("--bg-base: #09090b");
      expect(htmlStyles).toContain("::-webkit-scrollbar");
      expect(htmlStyles).toContain(".badge-pass");
      expect(htmlStyles).toContain(".badge-fail");
      expect(defStyles).toContain(".deficit-rank");
      expect(defStyles).toContain(".gain-badge-repo");
      expect(defStyles).toContain(".gain-badge-file");
      expect(getUnifiedStyles()).toContain("unified-tree-table");
    });
  });
});
