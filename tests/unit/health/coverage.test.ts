import { describe, expect, test } from "bun:test";
import {
  auditCoverageThresholds,
  generateCoverageReport,
  parseCoverageSummary,
  parseUncoveredLineTokens,
  scanUncoveredRegions,
  type FileCoverageMetric,
} from "../../../olt/scripts/src/health/coverage.ts";

describe("coverage audit engine", () => {
  test("parseUncoveredLineTokens correctly handles single numbers and ranges", () => {
    expect(parseUncoveredLineTokens("12, 15-18, 22")).toEqual([12, 15, 16, 17, 18, 22]);
    expect(parseUncoveredLineTokens("")).toEqual([]);
    expect(parseUncoveredLineTokens("   ")).toEqual([]);
    expect(parseUncoveredLineTokens("5-5")).toEqual([5]);
  });

  test("parseCoverageSummary extracts metrics and uncovered lines from bun test output", () => {
    const tableOutput = `
 src/core/engine.ts | 100.00 | 100.00 | 
 src/runner/ops.ts  |  96.50 |  95.00 | 14, 20-22
 src/legacy/bad.ts  |  80.00 |  75.00 | 10-50
`;
    const metrics = parseCoverageSummary(tableOutput);
    expect(metrics).toHaveLength(3);

    const engine = metrics.find((m) => m.file === "src/core/engine.ts");
    expect(engine).toBeDefined();
    expect(engine?.lines).toBe(1.0);
    expect(engine?.statements).toBe(1.0);
    expect(engine?.uncoveredLines).toEqual([]);

    const runner = metrics.find((m) => m.file === "src/runner/ops.ts");
    expect(runner).toBeDefined();
    expect(runner?.lines).toBe(0.965);
    expect(runner?.statements).toBe(0.95);
    expect(runner?.uncoveredLines).toEqual([14, 20, 21, 22]);

    const bad = metrics.find((m) => m.file === "src/legacy/bad.ts");
    expect(bad).toBeDefined();
    expect(bad?.lines).toBe(0.8);
    expect(bad?.statements).toBe(0.75);
    expect(bad?.uncoveredLines).toHaveLength(41);
  });

  test("auditCoverageThresholds validates 95% threshold requirement across files", () => {
    const passingMetrics: FileCoverageMetric[] = [
      {
        file: "src/a.ts",
        lines: 0.98,
        statements: 0.97,
        functions: 0.98,
        branches: 0.96,
        uncoveredLines: [10],
      },
      {
        file: "src/b.ts",
        lines: 1.0,
        statements: 1.0,
        functions: 1.0,
        branches: 1.0,
        uncoveredLines: [],
      },
    ];

    const passResult = auditCoverageThresholds(passingMetrics, 0.95);
    expect(passResult.passed).toBeTrue();
    expect(passResult.failing).toHaveLength(0);
    expect(passResult.passing).toHaveLength(2);
    expect(passResult.averageLines).toBeCloseTo(0.99, 2);

    const mixedMetrics: FileCoverageMetric[] = [
      ...passingMetrics,
      {
        file: "src/low.ts",
        lines: 0.92,
        statements: 0.9,
        functions: 0.92,
        uncoveredLines: [1, 2, 3],
      },
    ];

    const failResult = auditCoverageThresholds(mixedMetrics, 0.95);
    expect(failResult.passed).toBeFalse();
    expect(failResult.failing).toHaveLength(1);
    expect(failResult.failing[0]?.file).toBe("src/low.ts");
  });

  test("auditCoverageThresholds handles empty list gracefully", () => {
    const emptyResult = auditCoverageThresholds([], 0.95);
    expect(emptyResult.passed).toBeTrue();
    expect(emptyResult.averageLines).toBe(1.0);
  });

  test("scanUncoveredRegions identifies non-empty code lines for uncovered line numbers", () => {
    const source = `
export function add(a: number, b: number): number {
  if (a < 0) {
    return 0;
  }
  return a + b;
}
`;
    const regions = scanUncoveredRegions(source, [3, 4]);
    expect(regions).toHaveLength(2);
    expect(regions[0]?.line).toBe(3);
    expect(regions[0]?.snippet).toBe("if (a < 0) {");
    expect(regions[1]?.line).toBe(4);
    expect(regions[1]?.snippet).toBe("return 0;");
  });

  test("generateCoverageReport produces structured markdown report with passing and failing details", () => {
    const auditResult = auditCoverageThresholds(
      [
        {
          file: "src/good.ts",
          lines: 1.0,
          statements: 1.0,
          functions: 1.0,
          uncoveredLines: [],
        },
        {
          file: "src/sub.ts",
          lines: 0.88,
          statements: 0.9,
          functions: 0.88,
          uncoveredLines: [5],
        },
      ],
      0.95,
    );
    const markdown = generateCoverageReport(auditResult);
    expect(markdown).toContain("# Coverage Audit Certification Report");
    expect(markdown).toContain("❌ FAIL");
    expect(markdown).toContain("src/sub.ts");
    expect(markdown).toContain("88.0%");
  });

  test("auditCoverageThresholds flags files failing on branches even if lines pass", () => {
    const branchFailingMetric: FileCoverageMetric = {
      file: "src/branch-fail.ts",
      lines: 0.98,
      statements: 0.97,
      functions: 0.98,
      branches: 0.9,
      uncoveredLines: [12],
    };

    const result = auditCoverageThresholds([branchFailingMetric], 0.95);
    expect(result.passed).toBeFalse();
    expect(result.failing).toHaveLength(1);
    expect(result.failing[0]?.file).toBe("src/branch-fail.ts");
  });

  test("auditCoverageThresholds flags files failing on functions even if lines pass", () => {
    const functionFailingMetric: FileCoverageMetric = {
      file: "src/func-fail.ts",
      lines: 0.98,
      statements: 0.97,
      functions: 0.9,
      uncoveredLines: [22],
    };

    const result = auditCoverageThresholds([functionFailingMetric], 0.95);
    expect(result.passed).toBeFalse();
    expect(result.failing).toHaveLength(1);
    expect(result.failing[0]?.file).toBe("src/func-fail.ts");
  });
});
