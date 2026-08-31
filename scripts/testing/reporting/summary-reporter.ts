/**
 * Istanbul/NYC Coverage Summary Builder and Writer
 * Generates standardized coverage-summary.json files for Lines, Statements, Functions, and Runtime Telemetry.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  CoverageSummary,
  CoverageSummaryItem,
  FileCoverageMetric,
  TestRuntimeSummary,
  WriteCoverageOptions,
} from "./types.ts";
import { createMetricItem } from "./types.ts";

export function buildCoverageSummary(
  fileMap: Map<string, FileCoverageMetric>,
  runtime?: TestRuntimeSummary,
): CoverageSummary {
  let totalLinesFound = 0;
  let totalLinesHit = 0;
  let totalFnFound = 0;
  let totalFnHit = 0;
  let totalStmtFound = 0;
  let totalStmtHit = 0;

  const result: Record<string, CoverageSummaryItem> & { runtime?: TestRuntimeSummary } = {};

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

  if (runtime) {
    result.runtime = runtime;
  }

  return result;
}

export function writeSummaryJson(
  summary: CoverageSummary,
  repoRoot: string = process.cwd(),
  coverageDirName: string = "coverage",
  options?: WriteCoverageOptions,
): string {
  const root = resolve(repoRoot);
  const coverageDir = join(root, coverageDirName);
  const summaryPath = join(coverageDir, "coverage-summary.json");

  if (options?.writeToDisk === false) {
    return summaryPath;
  }

  if (!existsSync(coverageDir)) {
    mkdirSync(coverageDir, { recursive: true });
  }

  const payload = { ...summary };
  if (options?.runtime && !payload.runtime) {
    (payload as { runtime?: TestRuntimeSummary }).runtime = options.runtime;
  }

  const content = JSON.stringify(payload, null, 2);
  if (existsSync(summaryPath)) {
    try {
      const existing = readFileSync(summaryPath, "utf-8");
      if (existing === content) {
        return summaryPath;
      }
    } catch {
      // ignore read error, proceed to write
    }
  }

  writeFileSync(summaryPath, content, "utf-8");
  return summaryPath;
}
