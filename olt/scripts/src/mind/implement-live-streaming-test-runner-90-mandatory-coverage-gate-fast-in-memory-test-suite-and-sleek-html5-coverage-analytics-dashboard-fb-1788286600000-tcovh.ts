export const MANDATORY_COVERAGE_THRESHOLD = 90;

export interface TestStreamEvent {
  readonly id: string;
  readonly testName: string;
  readonly suiteName: string;
  readonly durationMs: number;
  readonly status: "pass" | "fail" | "skip";
  readonly errorSnippet?: string;
}

export interface StreamProcessingResult {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly totalDurationMs: number;
  readonly passRate: number;
}

export interface CoverageBreakdown {
  readonly linesPercentage: number;
  readonly statementsPercentage: number;
  readonly functionsPercentage: number;
  readonly branchesPercentage: number;
}

export interface CoverageGateVerdict {
  readonly meetsGate: boolean;
  readonly threshold: number;
  readonly averageCoverage: number;
  readonly breakdown: CoverageBreakdown;
  readonly deficit: number;
}

export function processTestStreamEvents(
  events: readonly TestStreamEvent[],
): StreamProcessingResult {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let totalDurationMs = 0;

  for (const evt of events) {
    totalDurationMs += evt.durationMs;
    if (evt.status === "pass") {
      passed += 1;
    } else if (evt.status === "fail") {
      failed += 1;
    } else {
      skipped += 1;
    }
  }

  const total = events.length;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 100;
  return {
    total,
    passed,
    failed,
    skipped,
    totalDurationMs,
    passRate,
  };
}

export function evaluateCoverageGate(breakdown: CoverageBreakdown): CoverageGateVerdict {
  const sum =
    breakdown.linesPercentage +
    breakdown.statementsPercentage +
    breakdown.functionsPercentage +
    breakdown.branchesPercentage;
  const averageCoverage = Math.round((sum / 4) * 10) / 10;
  const meetsGate = averageCoverage >= MANDATORY_COVERAGE_THRESHOLD;
  const deficit = meetsGate
    ? 0
    : Math.round((MANDATORY_COVERAGE_THRESHOLD - averageCoverage) * 10) / 10;
  return {
    meetsGate,
    threshold: MANDATORY_COVERAGE_THRESHOLD,
    averageCoverage,
    breakdown,
    deficit,
  };
}

export function renderHtml5CoverageDashboard(
  streamSummary: StreamProcessingResult,
  coverageVerdict: CoverageGateVerdict,
): string {
  const statusColor = coverageVerdict.meetsGate ? "#22c55e" : "#ef4444";
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="UTF-8">',
    "<title>Live Coverage Analytics Dashboard</title>",
    "<style>body { font-family: sans-serif; margin: 2rem; background: #0f172a; color: #f8fafc; }</style>",
    "</head>",
    "<body>",
    "<h1>Live Streaming Test & Coverage Dashboard</h1>",
    `<div style="border-left: 4px solid ${statusColor}; padding-left: 1rem;">`,
    `<p>Status: ${coverageVerdict.meetsGate ? "GATE PASSED" : "GATE FAILED"}</p>`,
    `<p>Average Coverage: ${coverageVerdict.averageCoverage}% (Threshold: ${coverageVerdict.threshold}%)</p>`,
    `<p>Tests: ${streamSummary.passed}/${streamSummary.total} passed (${streamSummary.totalDurationMs}ms)</p>`,
    "</div>",
    "</body>",
    "</html>",
  ].join("\n");
}
