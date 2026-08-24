/**
 * Istanbul/NYC Coverage Summary Builder and Writer
 * Generates standardized coverage-summary.json files for Lines, Statements, and Functions.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CoverageSummary, CoverageSummaryItem, FileCoverageMetric } from "./types.ts";
import { createMetricItem } from "./types.ts";

export function buildCoverageSummary(fileMap: Map<string, FileCoverageMetric>): CoverageSummary {
  let totalLinesFound = 0;
  let totalLinesHit = 0;
  let totalFnFound = 0;
  let totalFnHit = 0;
  let totalStmtFound = 0;
  let totalStmtHit = 0;

  const result: Record<string, CoverageSummaryItem> = {};

  for (const [filePath, metric] of fileMap.entries()) {
    totalLinesFound += metric.lines.total;
    totalLinesHit += metric.lines.covered;
    totalStmtFound += metric.statements.total;
    totalStmtHit += metric.statements.covered;
    totalFnFound += metric.functions.total;
    totalFnHit += metric.functions.covered;

    result[filePath] = {
      lines: metric.lines,
      statements: metric.statements,
      functions: metric.functions,
    };
  }

  result.total = {
    lines: createMetricItem(totalLinesHit, totalLinesFound),
    statements: createMetricItem(totalStmtHit, totalStmtFound),
    functions: createMetricItem(totalFnHit, totalFnFound),
  };

  return result;
}

export function writeSummaryJson(
  summary: CoverageSummary,
  repoRoot: string = process.cwd(),
  coverageDirName: string = "coverage",
): string {
  const root = resolve(repoRoot);
  const coverageDir = join(root, coverageDirName);
  if (!existsSync(coverageDir)) {
    mkdirSync(coverageDir, { recursive: true });
  }
  const summaryPath = join(coverageDir, "coverage-summary.json");
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf-8");
  return summaryPath;
}
