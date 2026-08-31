import type { CheckReport, Violation } from "../core/index.ts";

function compare(left: Violation, right: Violation): number {
  if (left.rule < right.rule) return -1;
  if (left.rule > right.rule) return 1;
  if (left.path < right.path) return -1;
  if (left.path > right.path) return 1;
  if (left.detail < right.detail) return -1;
  if (left.detail > right.detail) return 1;
  return 0;
}

export function sortViolations(violations: readonly Violation[]): readonly Violation[] {
  return [...violations].sort(compare);
}

export function renderJsonReport(report: CheckReport): string {
  return `${JSON.stringify({ schema: "olt-modularity-report/v1", ...report, violations: sortViolations(report.violations) }, null, 2)}\n`;
}
