import type { CheckReport } from "../core/index.ts";
import { sortViolations } from "./json.ts";

export function renderMarkdownReport(report: CheckReport): string {
  const findings = sortViolations(report.violations)
    .map((violation) => `- ${violation.rule}: \`${violation.path}\` — ${violation.detail}`)
    .join("\n");
  const content = findings.length > 0 ? findings : "No violations.";
  const status = report.passed ? "passed" : "failed";
  return `# Modularity report\n\nStatus: ${status}\n\n${content}\n`;
}
