import { describe, expect, test } from "bun:test";
import {
  buildHtmlDocument,
  buildUnifiedHierarchy,
  extractCoverageFileData,
  findMatchingSourceFile,
  findMatchingTestFile,
  formatHash,
  generateInteractiveHtml,
  getHtmlStyles,
  parseHash,
  type CoverageSummary,
  type FileCoverageMetric,
  type FileDetailData,
  type HashRoute,
  type TestRuntimeSummary,
} from "../../../../scripts/testing/reporting/index.ts";

function createProbeMetric(
  file: string,
  linesCovered: number,
  linesTotal: number,
  uncovered: number[] = [],
): FileCoverageMetric {
  const lineHits = new Map<number, number>();
  for (let i = 1; i <= linesTotal; i++) {
    lineHits.set(i, uncovered.includes(i) ? 0 : 1);
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
    uncoveredLines: uncovered,
    lineHits,
  };
}

function createProbeRuntime(): TestRuntimeSummary {
  const t1 = {
    file: "tests/testing/runner/streaming-runner.test.ts",
    durationMs: 700,
    percentage: 70,
    passed: true,
    testCount: 14,
  };
  const t2 = {
    file: "tests/testing/locks/test-mutex.test.ts",
    durationMs: 300,
    percentage: 30,
    passed: false,
    testCount: 6,
  };
  return {
    startTime: "2026-09-06T12:00:00.000Z",
    endTime: "2026-09-06T12:00:01.000Z",
    totalDurationMs: 1000,
    totalFiles: 2,
    avgDurationMs: 500,
    medianDurationMs: 500,
    slowestFile: t1,
    files: [t1, t2],
    pareto50: { percentage: 50, fileCount: 1, cumulativeDurationMs: 700, files: [t1] },
    pareto90: { percentage: 90, fileCount: 2, cumulativeDurationMs: 1000, files: [t1, t2] },
  };
}

describe("Two-Key Socratic Cognitive Adversarial Probes: Phase 4 Requirements", () => {
  test("Probe 1 (Obsidian Dark-Mode Aesthetic): Invariants, Palette, Glows & Typography", () => {
    const styles = getHtmlStyles();
    expect(styles).toContain("--bg-base:");
    expect(styles).toContain("--bg-surface: #0f1117");
    expect(styles).toContain("--bg-card: #18181b");
    expect(styles).toContain("--brand-accent: #38bdf8");
    expect(styles).toContain("--status-pass: #10b981");
    expect(styles).toContain("--status-fail: #ef4444");
    expect(styles).toContain("--status-warn: #f59e0b");
    expect(styles).toContain("::-webkit-scrollbar");
    expect(styles).toContain(".badge-p50");
    expect(styles).toContain(".badge-p90");
    expect(styles).toContain(".metric-progress-track");

    const html = buildHtmlDocument(styles, "");
    expect(html).toContain('<html lang="en" class="dark">');
    expect(html).toContain('class="loader-spinner"');
  });

  test("Probe 2 (Deep-Link Navigation & URL Hash Routing): Adversarial Paths, Escapes & Roundtrips", () => {
    const r1 = parseHash("#coverage/scripts/nested/file%20name.ts:L42");
    expect(r1.tab).toBe("coverage");
    expect(r1.path).toBe("scripts/nested/file name.ts");
    expect(r1.line).toBe(42);

    const rMalformed = parseHash("#coverage/path.ts:L-99");
    expect(rMalformed.line).toBeUndefined();

    const rNonNumeric = parseHash("#coverage/path.ts:Lnotanumber");
    expect(rNonNumeric.line).toBeUndefined();

    const rSpecial = parseHash("#coverage?search=%3Cscript%3Ealert(1)%3C%2Fscript%3E");
    expect(rSpecial.search).toBe("<script>alert(1)</script>");

    const routes: HashRoute[] = [
      { tab: "coverage", path: "scripts/index.ts", line: 15 },
      { tab: "runtime", file: "tests/foo.test.ts" },
      { tab: "unified", path: "scripts/testing" },
      { tab: "deficits", category: "error-handling" },
    ];

    for (const route of routes) {
      const serialized = formatHash(route);
      const parsed = parseHash(serialized);
      expect(parsed.tab).toBe(route.tab);
      if (route.path) expect(parsed.path).toBe(route.path);
      if (route.file) expect(parsed.file).toBe(route.file);
      if (route.category) expect(parsed.category).toBe(route.category);
    }
  });

  test("Probe 3 (Unified Filterable Timing & Coverage): Recursive Tree Aggregation & Pareto Hotspots", () => {
    const fileA: FileDetailData = {
      path: "scripts/testing/a.ts",
      linesPct: 90,
      statementsPct: 90,
      funcsPct: 100,
      linesCovered: 90,
      linesTotal: 100,
      statementsCovered: 90,
      statementsTotal: 100,
      funcsCovered: 10,
      funcsTotal: 10,
      uncoveredLines: [1, 2, 3],
      testDurationMs: 700,
      testPassed: true,
      testCount: 5,
      paretoClass: "p50",
    };

    const fileB: FileDetailData = {
      path: "scripts/testing/b.ts",
      linesPct: 50,
      statementsPct: 50,
      funcsPct: 50,
      linesCovered: 50,
      linesTotal: 100,
      statementsCovered: 50,
      statementsTotal: 100,
      funcsCovered: 5,
      funcsTotal: 10,
      uncoveredLines: [4, 5],
      testDurationMs: 300,
      testPassed: false,
      testCount: 3,
      paretoClass: "p90",
    };

    const tree = buildUnifiedHierarchy([fileA, fileB]);
    expect(tree.lines.total).toBe(200);
    expect(tree.lines.covered).toBe(140);
    expect(tree.lines.pct).toBe(70);
    expect(tree.testDurationMs).toBe(1000);
    expect(tree.children?.length).toBeGreaterThan(0);

    const testFiles = ["tests/testing/a.test.ts", "tests/testing/b.spec.ts"];
    const sourceFiles = ["scripts/testing/a.ts", "scripts/testing/b.ts"];
    expect(findMatchingTestFile("scripts/testing/a.ts", testFiles)).toBe("tests/testing/a.test.ts");
    expect(findMatchingSourceFile("tests/testing/b.spec.ts", sourceFiles)).toBe(
      "scripts/testing/b.ts",
    );
  });

  test("Probe 4 (Widescreen Layout & Deficit Integration): HTML Generation & Injection Resilience", () => {
    const fileMap = new Map<string, FileCoverageMetric>([
      ["scripts/testing/a.ts", createProbeMetric("scripts/testing/a.ts", 90, 100, [1, 2, 3])],
      ["scripts/testing/b.ts", createProbeMetric("scripts/testing/b.ts", 50, 100, [4, 5])],
    ]);

    const summary: CoverageSummary = {
      total: {
        lines: { total: 200, covered: 140, skipped: 0, pct: 70 },
        statements: { total: 200, covered: 140, skipped: 0, pct: 70 },
        functions: { total: 20, covered: 15, skipped: 0, pct: 75 },
      },
    };

    const runtime = createProbeRuntime();
    const html = generateInteractiveHtml(fileMap, summary, process.cwd(), runtime);

    expect(html).toContain('meta name="viewport" content="width=device-width, initial-scale=1.0"');
    expect(html).toContain('id="tab-coverage"');
    expect(html).toContain('id="tab-runtime"');
    expect(html).toContain('id="tab-unified"');
    expect(html).toContain('id="tab-deficits"');
    expect(html).toContain("unified-tree-table");
    expect(html).toContain("metric-progress-track");
    expect(html).toContain("initDeepLinks();");
  });
});
