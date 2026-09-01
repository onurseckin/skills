import type { CoverageArtifactResult } from "../reporting/index.ts";
import type { RunnerStats } from "./types.ts";

export interface SummaryTableOptions {
  readonly stats: RunnerStats;
  readonly durationMs: number;
  readonly coverageResult?: CoverageArtifactResult | undefined;
  readonly useColor?: boolean | undefined;
  readonly title?: string | undefined;
}

export function formatDuration(durationMs: number): string {
  const safeMs = Math.max(0, durationMs);
  if (safeMs < 1000) {
    return `${safeMs.toFixed(2)}ms`;
  }
  const seconds = safeMs / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(2)}s`;
  }
  const mins = Math.floor(seconds / 60);
  const remSec = (seconds % 60).toFixed(2);
  return `${mins}m ${remSec}s`;
}

export function getExecutionBadge(
  stats: RunnerStats,
  useColor: boolean = true,
): { label: string; text: string } {
  if (stats.testsFailed > 0 || stats.suitesFailed > 0) {
    const text = "[FAIL]";
    return {
      label: "FAIL",
      text: useColor ? `\x1b[1;31m${text}\x1b[0m` : text,
    };
  }
  if (stats.testsTotal === 0 || (stats.testsSkipped > 0 && stats.testsPassed === 0)) {
    const text = "[WARN]";
    return {
      label: "WARN",
      text: useColor ? `\x1b[1;33m${text}\x1b[0m` : text,
    };
  }
  const text = "[PASS]";
  return {
    label: "PASS",
    text: useColor ? `\x1b[1;32m${text}\x1b[0m` : text,
  };
}

export function formatSummaryTable(options: SummaryTableOptions): string {
  const {
    stats,
    durationMs,
    coverageResult,
    useColor = false,
    title = "TEST EXECUTION SUMMARY",
  } = options;

  const width = 80;
  const divider = "=".repeat(width);
  const subDivider = "  " + "-".repeat(width - 4);
  const badge = getExecutionBadge(stats, useColor);

  const headerPadding = Math.max(1, width - 4 - title.length - badge.label.length - 2);
  const headerLine = `  ${title}${" ".repeat(headerPadding)}${badge.text}`;

  const lines: string[] = [divider, headerLine, divider];

  // Test Suites
  const suiteParts: string[] = [];
  if (stats.suitesPassed > 0 || stats.suitesTotal === 0) {
    suiteParts.push(`${stats.suitesPassed} passed`);
  }
  if (stats.suitesFailed > 0) {
    suiteParts.push(`${stats.suitesFailed} failed`);
  }
  suiteParts.push(`${stats.suitesTotal} total`);
  lines.push(`  Test Files:      ${suiteParts.join(", ")}`);

  // Tests
  const testParts: string[] = [];
  if (stats.testsPassed > 0 || stats.testsTotal === 0) {
    testParts.push(`${stats.testsPassed} passed`);
  }
  if (stats.testsFailed > 0) {
    testParts.push(`${stats.testsFailed} failed`);
  }
  if (stats.testsSkipped > 0) {
    testParts.push(`${stats.testsSkipped} skipped`);
  }
  testParts.push(`${stats.testsTotal} total`);
  lines.push(`  Tests:           ${testParts.join(", ")}`);

  // Expect Calls
  lines.push(`  Expect Calls:    ${stats.expectCalls}`);

  // Duration
  lines.push(`  Duration:        ${formatDuration(durationMs)}`);

  // Coverage
  if (coverageResult) {
    const covPct =
      typeof coverageResult.totalPct === "number" ? coverageResult.totalPct.toFixed(2) : "0.00";
    const covFiles = coverageResult.filesCount ?? 0;
    lines.push(`  Coverage:        ${covPct}% line coverage (${covFiles} files)`);
  }

  // Failures section
  if (stats.failedTests.length > 0 || stats.failedSuites.length > 0) {
    lines.push(subDivider);
    lines.push("  Failures:");
    const maxItems = 10;
    const items =
      stats.failedTests.length > 0
        ? stats.failedTests.slice(0, maxItems).map((f) => `    - ${f.suite} > ${f.test}`)
        : stats.failedSuites.slice(0, maxItems).map((s) => `    - ${s}`);

    for (const item of items) {
      lines.push(item);
    }
    if (stats.failedTests.length > maxItems) {
      lines.push(`    ... and ${stats.failedTests.length - maxItems} more failure(s)`);
    }
  }

  lines.push(divider);
  return lines.join("\n");
}
