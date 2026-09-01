/**
 * Strict Repository Coverage Quality Gate
 * Evaluates repository line coverage against mandatory quality gate thresholds (default: >= 90.0%).
 * Provides fail-closed gate evaluation, deficit metrics, and diagnostic failure formatting.
 */

import type { CoverageSummary, CoverageSummaryItem } from "./types.ts";

export const DEFAULT_COVERAGE_THRESHOLD = 90.0;

export interface CoverageGateOptions {
  /**
   * Minimum required total line coverage percentage (0 - 100). Default is 90.0%.
   */
  readonly threshold?: number | undefined;
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
  readonly filesCount: number;
  readonly failingFiles: readonly FailingFileCoverage[];
  readonly totalLinesCovered: number;
  readonly totalLinesTotal: number;
}

/**
 * Evaluates coverage summary metrics against strict quality gate thresholds.
 */
export function evaluateCoverageGate(
  summary: CoverageSummary,
  options?: CoverageGateOptions,
): CoverageGateResult {
  const thresholdPct = options?.threshold ?? DEFAULT_COVERAGE_THRESHOLD;
  const fileThreshold = options?.fileThreshold;

  const totalItem = summary.total?.lines;
  const totalLinesCovered = totalItem?.covered ?? 0;
  const totalLinesTotal = totalItem?.total ?? 0;
  const totalPct =
    typeof totalItem?.pct === "number"
      ? totalItem.pct
      : totalLinesTotal > 0
        ? Math.round((totalLinesCovered / totalLinesTotal) * 10000) / 100
        : 0;

  const deficitPct =
    totalPct < thresholdPct ? Math.round((thresholdPct - totalPct) * 100) / 100 : 0;

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

  const passed = totalPct >= thresholdPct && failingFiles.length === 0;

  return {
    passed,
    totalPct,
    thresholdPct,
    deficitPct,
    filesCount,
    failingFiles,
    totalLinesCovered,
    totalLinesTotal,
  };
}

/**
 * Formats structured quality gate diagnostics into human-readable summary strings.
 */
export function formatCoverageGateMessage(result: CoverageGateResult): string {
  if (result.passed) {
    return `✓ [coverage-gate] Quality Gate PASSED: Overall Line Coverage is ${result.totalPct}% (Threshold: >= ${result.thresholdPct}%, ${result.totalLinesCovered}/${result.totalLinesTotal} lines across ${result.filesCount} files).`;
  }

  const lines: string[] = [
    `❌ [coverage-gate] Quality Gate FAILED: Overall Line Coverage is ${result.totalPct}%, below the required ${result.thresholdPct}% threshold (Deficit: -${result.deficitPct}%, ${result.totalLinesCovered}/${result.totalLinesTotal} lines across ${result.filesCount} files).`,
  ];

  if (result.failingFiles.length > 0) {
    lines.push("  Failing modules below threshold:");
    for (const file of result.failingFiles) {
      lines.push(
        `    - ${file.file}: ${file.linesPct}% (${file.linesCovered}/${file.linesTotal} lines)`,
      );
    }
  }

  return lines.join("\n");
}
