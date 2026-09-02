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
  const thresholdPct = options?.threshold ?? DEFAULT_COVERAGE_THRESHOLD;
  const funcsThresholdPct = options?.functionsThreshold ?? DEFAULT_FUNCTIONS_THRESHOLD;
  const fileThreshold = options?.fileThreshold;

  const totalLinesItem = summary.total?.lines;
  const totalLinesCovered = totalLinesItem?.covered ?? 0;
  const totalLinesTotal = totalLinesItem?.total ?? 0;
  const totalPct =
    typeof totalLinesItem?.pct === "number"
      ? totalLinesItem.pct
      : totalLinesTotal > 0
        ? Math.round((totalLinesCovered / totalLinesTotal) * 10000) / 100
        : 0;

  const totalFuncsItem = summary.total?.functions;
  const totalFuncsCovered = totalFuncsItem?.covered ?? 0;
  const totalFuncsTotal = totalFuncsItem?.total ?? 0;
  const funcsPct =
    typeof totalFuncsItem?.pct === "number"
      ? totalFuncsItem.pct
      : totalFuncsTotal > 0
        ? Math.round((totalFuncsCovered / totalFuncsTotal) * 10000) / 100
        : 0;

  const deficitPct =
    totalPct < thresholdPct ? Math.round((thresholdPct - totalPct) * 100) / 100 : 0;
  const funcsDeficitPct =
    funcsPct < funcsThresholdPct ? Math.round((funcsThresholdPct - funcsPct) * 100) / 100 : 0;

  const failingFiles: FailingFileCoverage[] = [];
  let filesCount = 0;

  for (const [key, val] of Object.entries(summary)) {
    if (key === "total" || key === "runtime") continue;
    const fileCoverage = val as CoverageSummaryItem | undefined;
    if (!fileCoverage || !fileCoverage.lines) continue;
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
  if (result.totalPct < result.thresholdPct || result.funcsPct < result.funcsThresholdPct) {
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
