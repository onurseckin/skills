import { describe, expect, test } from "bun:test";
import {
  formatHash,
  generateInteractiveHtml,
  getClientScriptDeeplink,
  parseHash,
  type CoverageSummary,
  type FileCoverageMetric,
  type TestRuntimeSummary,
} from "../../../scripts/testing/reporting/index.ts";

function createMockMetric(
  file: string,
  linesCovered = 10,
  linesTotal = 10,
  uncoveredLines: number[] = [],
): FileCoverageMetric {
  const lineHits = new Map<number, number>();
  for (let i = 1; i <= linesTotal; i++) {
    lineHits.set(i, uncoveredLines.includes(i) ? 0 : 1);
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
    file: "tests/testing/ranking/runtime-ranking.test.ts",
    durationMs: 450,
    percentage: 60,
    passed: true,
    testCount: 8,
  };
  const test2 = {
    file: "tests/testing/ranking/deficit-clustering.test.ts",
    durationMs: 300,
    percentage: 40,
    passed: true,
    testCount: 5,
  };
  return {
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
    totalDurationMs: 750,
    totalFiles: 2,
    avgDurationMs: 375,
    medianDurationMs: 375,
    slowestFile: test1,
    files: [test1, test2],
    pareto50: { percentage: 50, fileCount: 1, cumulativeDurationMs: 450, files: [test1] },
    pareto90: { percentage: 90, fileCount: 2, cumulativeDurationMs: 750, files: [test1, test2] },
  };
}

describe("Wave 4 & 5 Deep-Linking & Interactivity", () => {
  describe("parseHash URL Hash Router", () => {
    test("handles empty, hash-only, and invalid hash inputs", () => {
      expect(parseHash("")).toEqual({ tab: "coverage" });
      expect(parseHash("#")).toEqual({ tab: "coverage" });
      expect(parseHash("   ")).toEqual({ tab: "coverage" });
    });

    test("parses coverage tab routes with path, line numbers, and query params", () => {
      expect(parseHash("#coverage")).toEqual({ tab: "coverage", path: undefined });
      expect(parseHash("#coverage/scripts/testing/reporting/types.ts")).toEqual({
        tab: "coverage",
        path: "scripts/testing/reporting/types.ts",
        line: undefined,
      });
      expect(parseHash("#coverage/scripts/testing/reporting/types.ts:L42")).toEqual({
        tab: "coverage",
        path: "scripts/testing/reporting/types.ts",
        line: 42,
      });
      expect(parseHash("#coverage?filter=miss&search=runner")).toEqual({
        tab: "coverage",
        filter: "miss",
        search: "runner",
      });
    });

    test("parses runtime tab routes with test file targets and search queries", () => {
      expect(parseHash("#runtime")).toEqual({ tab: "runtime" });
      expect(parseHash("#runtime?file=tests/testing/ranking/runtime-ranking.test.ts")).toEqual({
        tab: "runtime",
        file: "tests/testing/ranking/runtime-ranking.test.ts",
      });
      expect(parseHash("#runtime/tests/testing/ranking/runtime-ranking.test.ts")).toEqual({
        tab: "runtime",
        file: "tests/testing/ranking/runtime-ranking.test.ts",
      });
    });

    test("parses unified hierarchy tab routes with folder path and filters", () => {
      expect(parseHash("#unified")).toEqual({ tab: "unified" });
      expect(parseHash("#unified/scripts/testing")).toEqual({
        tab: "unified",
        path: "scripts/testing",
      });
      expect(parseHash("#unified?filter=slow&search=core")).toEqual({
        tab: "unified",
        filter: "slow",
        search: "core",
      });
    });

    test("parses deficits tab routes with category filter and search", () => {
      expect(parseHash("#deficits")).toEqual({ tab: "deficits" });
      expect(parseHash("#deficits?category=error-handling")).toEqual({
        tab: "deficits",
        category: "error-handling",
      });
      expect(parseHash("#deficits?category=branching&search=session")).toEqual({
        tab: "deficits",
        category: "branching",
        search: "session",
      });
      expect(parseHash("#deficits/scripts/runner.ts:L15")).toEqual({
        tab: "deficits",
        file: "scripts/runner.ts",
        line: 15,
      });
    });

    test("parses bare file paths and query parameters gracefully", () => {
      expect(parseHash("#scripts/testing/runner.ts:L50")).toEqual({
        tab: "coverage",
        path: "scripts/testing/runner.ts",
        line: 50,
      });
      expect(parseHash("?tab=deficits&category=initialization")).toEqual({
        tab: "deficits",
        category: "initialization",
      });
      expect(parseHash("#coverage?line=-5").line).toBeUndefined();
    });
  });

  describe("formatHash Route Serializer", () => {
    test("formats coverage routes with paths, lines, and filters", () => {
      expect(formatHash({ tab: "coverage" })).toBe("#coverage");
      expect(formatHash({ tab: "coverage", path: "scripts/index.ts", line: 42 })).toBe(
        "#coverage/scripts/index.ts:L42",
      );
      expect(formatHash({ tab: "coverage", filter: "miss" })).toBe("#coverage?filter=miss");
    });

    test("formats runtime routes with file focus and search filters", () => {
      expect(formatHash({ tab: "runtime" })).toBe("#runtime");
      expect(formatHash({ tab: "runtime", file: "tests/unit.test.ts" })).toBe(
        "#runtime?file=tests%2Funit.test.ts",
      );
    });

    test("formats unified hierarchy and deficit routes", () => {
      expect(formatHash({ tab: "unified", path: "scripts/reporting" })).toBe(
        "#unified/scripts/reporting",
      );
      expect(formatHash({ tab: "deficits" })).toBe("#deficits");
      expect(formatHash({ tab: "deficits", category: "error-handling" })).toBe(
        "#deficits?category=error-handling",
      );
      expect(formatHash({ tab: "deficits", search: "auth" })).toBe("#deficits?search=auth");
    });
  });

  describe("HTML Dashboard Integration & Deficit Routing", () => {
    test("getClientScriptDeeplink includes deficit routing support", () => {
      const script = getClientScriptDeeplink();
      expect(script).toContain("function parseHash(hash)");
      expect(script).toContain("function applyHashRoute()");
      expect(script).toContain('route.tab === "deficits"');
      expect(script).toContain("setDeficitCategoryFilter");
      expect(script).toContain("openDeficitCluster");
    });

    test("generateInteractiveHtml embeds deep link router and cross-tab hooks", () => {
      const fileMap = new Map<string, FileCoverageMetric>([
        [
          "scripts/testing/reporting/runtime-telemetry.ts",
          createMockMetric("scripts/testing/reporting/runtime-telemetry.ts", 20, 20),
        ],
        [
          "scripts/testing/reporting/deficit-clustering.ts",
          createMockMetric("scripts/testing/reporting/deficit-clustering.ts", 15, 20, [18, 19, 20]),
        ],
      ]);
      const summary: CoverageSummary = {
        total: {
          lines: { total: 40, covered: 35, skipped: 0, pct: 87.5 },
          statements: { total: 40, covered: 35, skipped: 0, pct: 87.5 },
          functions: { total: 4, covered: 4, skipped: 0, pct: 100 },
        },
      };
      const runtime = createSampleRuntime();
      const html = generateInteractiveHtml(fileMap, summary, process.cwd(), runtime);

      expect(html).toContain("initDeepLinks();");
      expect(html).toContain("tab-deficits");
      expect(html).toContain("deficits-section");
      expect(html).toContain("openDeficitCluster");
      expect(html).toContain("initDeficitMetrics");
    });

    test("HTML dashboard binds search input event listeners to URL hash synchronization", () => {
      const fileMap = new Map<string, FileCoverageMetric>([
        ["scripts/types.ts", createMockMetric("scripts/types.ts", 10, 10)],
      ]);
      const summary: CoverageSummary = {
        total: {
          lines: { total: 10, covered: 10, skipped: 0, pct: 100 },
          statements: { total: 10, covered: 10, skipped: 0, pct: 100 },
          functions: { total: 2, covered: 2, skipped: 0, pct: 100 },
        },
      };
      const html = generateInteractiveHtml(fileMap, summary, process.cwd());

      expect(html).toContain(
        'updateHash(searchQuery ? "#coverage?search=" + encodeURIComponent(searchQuery) : "#coverage");',
      );
      expect(html).toContain(
        'updateHash(runtimeSearch ? "#runtime?search=" + encodeURIComponent(runtimeSearch) : "#runtime");',
      );
      expect(html).toContain(
        'updateHash(unifiedSearch ? "#unified?search=" + encodeURIComponent(unifiedSearch) : "#unified");',
      );
      expect(html).toContain("deficitSearch");
    });
  });
});
