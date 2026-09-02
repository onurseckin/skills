/**
 * Strict Repository Coverage Quality Gate
 * Evaluates repository line and function coverage against mandatory quality gate thresholds:
 * - Line Coverage: >= 90.0%
 * - Function Coverage: >= 95.0%
 * Provides fail-closed gate evaluation, deficit metrics, and diagnostic failure formatting.
 */

import type { CoverageSummary, CoverageSummaryItem } from "./types.ts";

export const DEFAULT_COVERAGE_THRESHOLD = 90.0;
export const DEFAULT_FUNCTIONS_THRESHOLD = 95.0;

export interface CoverageGateOptions {
  /**
   * Minimum required total line coverage percentage (0 - 100). Default is 90.0%.
   */
  readonly threshold?: number | undefined;
  /**
   * Minimum required total function coverage percentage (0 - 100). Default is 95.0%.
   */
  readonly functionsThreshold?: number | undefined;
  /**
   * Optional minimum required per-file line coverage percentage (0 - 100).
   */
  readonly fileThreshold?: number | undefined;
}

export interface FailingFileCoverage {
  readonly file: string;
  readonly linesPct: number;
  readonly linesCovered: number;
  readonly linesTotal: number;
}

export interface CoverageGateResult {
  readonly passed: boolean;
  readonly totalPct: number;
  readonly thresholdPct: number;
  readonly deficitPct: number;
  readonly funcsPct: number;
  readonly funcsThresholdPct: number;
  readonly funcsDeficitPct: number;
  readonly filesCount: number;
  readonly failingFiles: readonly FailingFileCoverage[];
  readonly totalLinesCovered: number;
  readonly totalLinesTotal: number;
  readonly totalFuncsCovered: number;
  readonly totalFuncsTotal: number;
}

/**
 * Evaluates coverage summary metrics against strict quality gate thresholds.
 */
export function evaluateCoverageGate(
  summary: CoverageSummary,
  options?: CoverageGateOptions,
): CoverageGateResult {
  let thresholdPct = DEFAULT_COVERAGE_THRESHOLD;
  if (options !== undefined && typeof options.threshold === "number") {
    thresholdPct = options.threshold;
  }

  let funcsThresholdPct = DEFAULT_FUNCTIONS_THRESHOLD;
  if (options !== undefined && typeof options.functionsThreshold === "number") {
    funcsThresholdPct = options.functionsThreshold;
  }

  const fileThreshold = options !== undefined ? options.fileThreshold : undefined;

  const totalLinesItem = summary.total !== undefined ? summary.total.lines : undefined;
  let totalLinesCovered = 0;
  if (totalLinesItem !== undefined && typeof totalLinesItem.covered === "number") {
    totalLinesCovered = totalLinesItem.covered;
  }

  let totalLinesTotal = 0;
  if (totalLinesItem !== undefined && typeof totalLinesItem.total === "number") {
    totalLinesTotal = totalLinesItem.total;
  }

  let totalPct = 0;
  if (totalLinesItem !== undefined && typeof totalLinesItem.pct === "number") {
    totalPct = totalLinesItem.pct;
  } else if (totalLinesTotal > 0) {
    totalPct = Math.round((totalLinesCovered / totalLinesTotal) * 10000) / 100;
  }

  const totalFuncsItem = summary.total !== undefined ? summary.total.functions : undefined;
  let totalFuncsCovered = 0;
  if (totalFuncsItem !== undefined && typeof totalFuncsItem.covered === "number") {
    totalFuncsCovered = totalFuncsItem.covered;
  }

  let totalFuncsTotal = 0;
  if (totalFuncsItem !== undefined && typeof totalFuncsItem.total === "number") {
    totalFuncsTotal = totalFuncsItem.total;
  }

  let funcsPct = 0;
  if (totalFuncsItem !== undefined && typeof totalFuncsItem.pct === "number") {
    funcsPct = totalFuncsItem.pct;
  } else if (totalFuncsTotal > 0) {
    funcsPct = Math.round((totalFuncsCovered / totalFuncsTotal) * 10000) / 100;
  }

  const deficitPct =
    totalPct < thresholdPct ? Math.round((thresholdPct - totalPct) * 100) / 100 : 0;
  const funcsDeficitPct =
    funcsPct < funcsThresholdPct ? Math.round((funcsThresholdPct - funcsPct) * 100) / 100 : 0;

  const failingFiles: FailingFileCoverage[] = [];
  let filesCount = 0;

  for (const [key, val] of Object.entries(summary)) {
    if (key === "total") continue;
    if (key === "runtime") continue;
    const fileCoverage = val as CoverageSummaryItem | undefined;
    if (fileCoverage === undefined) continue;
    if (fileCoverage === null) continue;
    if (fileCoverage.lines === undefined) continue;
    if (fileCoverage.lines === null) continue;
    filesCount++;
    if (fileThreshold !== undefined && fileCoverage.lines.pct < fileThreshold) {
      failingFiles.push({
        file: key,
        linesPct: fileCoverage.lines.pct,
        linesCovered: fileCoverage.lines.covered,
        linesTotal: fileCoverage.lines.total,
      });
    }
  }

  const linesPassed = totalPct >= thresholdPct;
  const funcsPassed = funcsPct >= funcsThresholdPct;
  const filesPassed = failingFiles.length === 0;
  const passed = linesPassed && funcsPassed && filesPassed;

  return {
    passed,
    totalPct,
    thresholdPct,
    deficitPct,
    funcsPct,
    funcsThresholdPct,
    funcsDeficitPct,
    filesCount,
    failingFiles,
    totalLinesCovered,
    totalLinesTotal,
    totalFuncsCovered,
    totalFuncsTotal,
  };
}

/**
 * Formats structured quality gate diagnostics into human-readable summary strings.
 */
export function formatCoverageGateMessage(result: CoverageGateResult): string {
  if (result.passed) {
    return `✓ [coverage-gate] Quality Gate PASSED: Lines ${result.totalPct}% (>= ${result.thresholdPct}%, ${result.totalLinesCovered}/${result.totalLinesTotal}) | Functions ${result.funcsPct}% (>= ${result.funcsThresholdPct}%, ${result.totalFuncsCovered}/${result.totalFuncsTotal}) across ${result.filesCount} files.`;
  }

  const lines: string[] = [];
  const linesUnderThreshold = result.totalPct < result.thresholdPct;
  const funcsUnderThreshold = result.funcsPct < result.funcsThresholdPct;
  if (linesUnderThreshold) {
    lines.push(
      `❌ [coverage-gate] Quality Gate FAILED:\n` +
        `   • Lines:     ${result.totalPct}% (Required: >= ${result.thresholdPct}%, Deficit: -${result.deficitPct}%, ${result.totalLinesCovered}/${result.totalLinesTotal})\n` +
        `   • Functions: ${result.funcsPct}% (Required: >= ${result.funcsThresholdPct}%, Deficit: -${result.funcsDeficitPct}%, ${result.totalFuncsCovered}/${result.totalFuncsTotal})`,
    );
  } else if (funcsUnderThreshold) {
    lines.push(
      `❌ [coverage-gate] Quality Gate FAILED:\n` +
        `   • Lines:     ${result.totalPct}% (Required: >= ${result.thresholdPct}%, Deficit: -${result.deficitPct}%, ${result.totalLinesCovered}/${result.totalLinesTotal})\n` +
        `   • Functions: ${result.funcsPct}% (Required: >= ${result.funcsThresholdPct}%, Deficit: -${result.funcsDeficitPct}%, ${result.totalFuncsCovered}/${result.totalFuncsTotal})`,
    );
  }

  if (result.failingFiles.length > 0) {
    lines.push("   Failing modules below threshold:");
    for (const file of result.failingFiles) {
      lines.push(
        `     - ${file.file}: ${file.linesPct}% (${file.linesCovered}/${file.linesTotal} lines)`,
      );
    }
  }

  return lines.join("\n");
}
