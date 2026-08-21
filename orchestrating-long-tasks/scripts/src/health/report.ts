import type { HealthCheckResult, HealthFinding, HealthReport } from "./types.ts";

const DEFAULT_LISTED = 5;

function location(entry: HealthFinding): string {
  return entry.line === undefined ? `\`${entry.file}\`` : `\`${entry.file}:${entry.line}\``;
}

function line(entry: HealthFinding): string {
  const acknowledged =
    entry.acknowledged === undefined ? "" : ` _(allowed: ${entry.acknowledged})_`;
  return `- ${location(entry)} - ${entry.detail}${acknowledged}`;
}

function section(result: HealthCheckResult, listed: number): string[] {
  const failures = result.findings.filter(
    (entry) => entry.severity === "failure" && entry.acknowledged === undefined,
  );
  const advisories = result.findings.filter((entry) => entry.severity === "advisory");
  const allowed = result.findings.filter((entry) => entry.acknowledged !== undefined);
  const shown = failures.slice(0, listed);
  return [
    "",
    `#### ${result.title}`,
    `- **Failures**: ${failures.length} | **Advisories**: ${advisories.length} | **Allowed**: ${allowed.length} | **Inspected**: ${result.scanned}`,
    ...shown.map(line),
    ...(failures.length > shown.length
      ? [`- _... ${failures.length - shown.length} more failure(s); use --all_`]
      : []),
    ...allowed.map(line),
    ...(listed === Number.MAX_SAFE_INTEGER ? advisories.map(line) : []),
    "- **Cannot check**:",
    ...result.limitations.map((text) => `  - ${text}`),
  ];
}

export function renderHealthReport(report: HealthReport, root: string, all = false): string {
  const listed = all ? Number.MAX_SAFE_INTEGER : DEFAULT_LISTED;
  const verdict = report.healthy ? "healthy" : "UNHEALTHY";
  return [
    `### Semantic Health: \`${root}\``,
    `- **Verdict**: ${verdict}`,
    `- **Failures**: ${report.failure_count} | **Advisories**: ${report.advisory_count} | **Allowed**: ${report.acknowledged_count}`,
    `- **Checks run**: ${report.checks.length}${report.skipped.length > 0 ? `, skipped ${report.skipped.length}` : ""}`,
    ...report.checks.flatMap((result) => section(result, listed)),
    ...(report.skipped.length > 0
      ? [
          "",
          "#### Not run",
          ...report.skipped.map((entry) => `- \`${entry.check}\`: ${entry.reason}`),
        ]
      : []),
  ].join("\n");
}
