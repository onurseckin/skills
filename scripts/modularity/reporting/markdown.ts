import type { CheckReport } from "../core/index.ts";
import { sortViolations } from "./json.ts";

export function renderMarkdownReport(report: CheckReport): string {
  const findings = sortViolations(report.violations)
    .map((violation) => `- ${violation.rule}: \`${violation.path}\` — ${violation.detail}`)
    .join("\n");
  return `# Modularity report\n\nStatus: ${report.passed ? "passed" : "failed"}\n\n${findings.length > 0 ? findings : "No violations."}\n`;
}
