/**
 * Unified Coverage Reporting Subsystem Entrypoint and Barrel Export
 * Orchestrates parsing lcov.info, building JSON summary, Markdown report, and HTML dashboard.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { writeInteractiveHtml } from "./html/index.ts";
import { parseLcov } from "./lcov-parser.ts";
import { writeMarkdownReport } from "./markdown-reporter.ts";
import { buildCoverageSummary, writeSummaryJson } from "./summary-reporter.ts";
import type { CoverageArtifactResult } from "./types.ts";

export type {
  CoverageArtifactResult,
  CoverageSummary,
  CoverageSummaryItem,
  FileCoverageMetric,
  FileDetailData,
  MetricItem,
  SourceLineDetail,
} from "./types.ts";
export { calculatePct, createMetricItem } from "./types.ts";
export { parseLcov } from "./lcov-parser.ts";
export { buildCoverageSummary, writeSummaryJson } from "./summary-reporter.ts";
export { buildMarkdownReport, writeMarkdownReport } from "./markdown-reporter.ts";
export {
  buildHtmlDocument,
  extractCoverageFileData,
  generateInteractiveHtml,
  getClientScript,
  getHtmlStyles,
  writeInteractiveHtml,
} from "./html/index.ts";

export function processCoverageArtifacts(
  repoRoot?: string,
  coverageDirName: string = "coverage",
): CoverageArtifactResult {
  const root = repoRoot ? resolve(repoRoot) : process.cwd();
  const coverageDir = join(root, coverageDirName);
  const lcovPath = join(coverageDir, "lcov.info");

  if (!existsSync(lcovPath)) {
    return { lcovExists: false, filesCount: 0, totalPct: 0 };
  }

  const lcovContent = readFileSync(lcovPath, "utf-8");
  const fileMap = parseLcov(lcovContent, root);
  const summary = buildCoverageSummary(fileMap);

  // 1. Write standard Istanbul/NYC coverage-summary.json
  const summaryPath = writeSummaryJson(summary, root, coverageDirName);

  // 2. Write human-readable REPORT.md
  const reportPath = writeMarkdownReport(fileMap, summary, root, coverageDirName);

  // 3. Write modern interactive HTML dashboard index.html
  const htmlPath = writeInteractiveHtml(fileMap, summary, root, coverageDirName);

  const totalPct =
    typeof summary.total !== "undefined" &&
    summary.total !== null &&
    typeof summary.total.lines !== "undefined" &&
    typeof summary.total.lines.pct === "number"
      ? summary.total.lines.pct
      : 0;

  return {
    lcovExists: true,
    filesCount: fileMap.size,
    totalPct,
    summaryPath,
    reportPath,
    htmlPath,
  };
}

export function computeIsMain(
  mainVal: boolean = import.meta.main,
  entryArg: string | undefined = process.argv[1],
): boolean {
  if (mainVal) return true;
  if (!entryArg) return false;
  if (entryArg.endsWith("scripts/testing/reporting/index.ts")) return true;
  if (entryArg.endsWith("scripts/testing/reporting")) return true;
  return false;
}

export function main(): void {
  const res = processCoverageArtifacts();
  if (res.lcovExists) {
    console.log(
      `[coverage] Generated coverage/lcov.info, coverage/coverage-summary.json, coverage/REPORT.md, and coverage/index.html across ${res.filesCount} files (${res.totalPct}% line coverage).`,
    );
  } else {
    console.log("[coverage] No coverage/lcov.info found to process.");
  }
}

export function runCli(isMain: boolean = computeIsMain()): void {
  if (isMain) {
    main();
  }
}

// Auto-execute if invoked as CLI script
runCli();

