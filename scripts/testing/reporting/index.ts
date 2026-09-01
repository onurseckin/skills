// @ts-nocheck
/**
 * Unified Coverage Reporting Subsystem Entrypoint and Barrel Export
 * Orchestrates parsing lcov.info, building JSON summary, Markdown report, and HTML dashboard.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { writeInteractiveHtml } from "./html/index.ts";
import { parseLcov } from "./lcov-parser.ts";
import { writeMarkdownReport } from "./markdown-reporter.ts";
import { parseTestRuntimeOutput } from "./runtime-telemetry.ts";
import { buildCoverageSummary, writeSummaryJson } from "./summary-reporter.ts";
import type {
  CoverageArtifactResult,
  ProcessCoverageOptions,
  TestRuntimeSummary,
} from "./types.ts";

export type {
  CoverageArtifactResult,
  CoverageSummary,
  CoverageSummaryItem,
  DeficitCategory,
  DeficitCategoryBreakdown,
  DeficitCluster,
  DeficitClusteringOptions,
  DeficitRoadmap,
  FileCoverageMetric,
  FileDetailData,
  MetricItem,
  ParetoThreshold,
  ProcessCoverageOptions,
  SourceLineDetail,
  TestFileRuntime,
  TestRuntimeSummary,
  UnifiedHierarchyNode,
  WriteCoverageOptions,
} from "./types.ts";
export type { ContiguousLineSegment, DeficitCategoryClassification } from "./deficit-clustering.ts";
export type {
  CoverageGateOptions,
  CoverageGateResult,
  FailingFileCoverage,
} from "./coverage-gate.ts";
export type { HashRoute } from "./html/index.ts";
export {
  DEFAULT_COVERAGE_THRESHOLD,
  evaluateCoverageGate,
  formatCoverageGateMessage,
} from "./coverage-gate.ts";
export {
  buildDeficitClusters,
  calculateImpactPct,
  classifyDeficitCategory,
  formatDeficitRoadmapMarkdown,
  generateDeficitRoadmap,
  getCategoryBadge,
  groupContiguousLines,
} from "./deficit-clustering.ts";
export { calculatePct, createMetricItem } from "./types.ts";
export { parseLcov } from "./lcov-parser.ts";
export { buildCoverageSummary, writeSummaryJson } from "./summary-reporter.ts";
export {
  formatRuntimeMarkdown,
  buildMarkdownReport,
  writeMarkdownReport,
} from "./markdown-reporter.ts";
export {
  calculateParetoThreshold,
  computeRuntimeSummary,
  parseDurationToMs,
  parseTestRuntimeOutput,
  sliceRuntimePagination,
} from "./runtime-telemetry.ts";
export {
  buildHtmlDocument,
  buildUnifiedHierarchy,
  extractCoverageFileData,
  findMatchingSourceFile,
  findMatchingTestFile,
  formatHash,
  generateInteractiveHtml,
  getClientScript,
  getClientScriptDeeplink,
  getClientScriptDeficits,
  getClientScriptHelpers,
  getClientScriptRuntime,
  getClientScriptUnified,
  getCodeViewerStyles,
  getDeficitStyles,
  getHtmlStyles,
  getRuntimeStyles,
  getUnifiedStyles,
  parseHash,
  writeInteractiveHtml,
} from "./html/index.ts";

export function processCoverageArtifacts(
  repoRoot?: string,
  coverageDirName: string = "coverage",
  options?: ProcessCoverageOptions,
): CoverageArtifactResult {
  const root = repoRoot ? resolve(repoRoot) : process.cwd();
  const coverageDir = join(root, coverageDirName);
  const lcovPath = join(coverageDir, "lcov.info");

  let lcovContent = options?.lcovContent;
  if (typeof lcovContent !== "string") {
    if (!existsSync(lcovPath)) {
      return { lcovExists: false, filesCount: 0, totalPct: 0 };
    }
    lcovContent = readFileSync(lcovPath, "utf-8");
  }

  let runtime: TestRuntimeSummary | undefined = options?.runtime;
  if (!runtime && options?.testOutput) {
    runtime = parseTestRuntimeOutput(
      options.testOutput,
      options.startTime,
      options.endTime,
      options.totalDurationMs,
    );
  }

  const fileMap = parseLcov(lcovContent, root);
  const summary = buildCoverageSummary(fileMap, runtime);

  const shouldWriteToDisk = options?.writeToDisk !== false;

  let summaryPath: string | undefined;
  let reportPath: string | undefined;
  let htmlPath: string | undefined;

  if (shouldWriteToDisk) {
    // 1. Write standard Istanbul/NYC coverage-summary.json
    summaryPath = writeSummaryJson(summary, root, coverageDirName, {
      writeToDisk: true,
      skipIfUnchanged: options?.skipIfUnchanged,
      runtime,
    });

    // 2. Write human-readable REPORT.md
    reportPath = writeMarkdownReport(fileMap, summary, root, coverageDirName, runtime);

    // 3. Write modern interactive HTML dashboard index.html
    htmlPath = writeInteractiveHtml(fileMap, summary, root, coverageDirName, runtime);
  }

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
    summary,
    runtime,
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

export function main(repoRoot?: string): void {
  const res = processCoverageArtifacts(repoRoot);
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
