import type { CheckReport, Violation } from "../core/index.ts";

function compare(left: Violation, right: Violation): number {
  return left.rule < right.rule
    ? -1
    : left.rule > right.rule
      ? 1
      : left.path < right.path
        ? -1
        : left.path > right.path
          ? 1
          : left.detail < right.detail
            ? -1
            : left.detail > right.detail
              ? 1
              : 0;
}

export function sortViolations(violations: readonly Violation[]): readonly Violation[] {
  return [...violations].sort(compare);
}

export function renderJsonReport(report: CheckReport): string {
  return `${JSON.stringify({ schema: "olt-modularity-report/v1", ...report, violations: sortViolations(report.violations) }, null, 2)}\n`;
}
