/**
 * Behavioral Auditor Health Summarizer & Markdown Formatter
 */
import type { BehavioralFinding, BehavioralHealthSummary } from "./types.ts";

export function summarizeBehavioralHealth(
  findings: readonly BehavioralFinding[],
): BehavioralHealthSummary {
  const issues = findings.map(
    (f) => `behavioral [${f.severity}] (${f.role}/${f.agent_id}): ${f.observation}`,
  );
  return {
    healthy: findings.length === 0,
    violation_count: findings.length,
    findings: [...findings],
    issues,
  };
}

export function formatBehavioralRoleHealthSection(findings: readonly BehavioralFinding[]): string {
  const lines: string[] = ["### Behavioral Role Health"];
  if (findings.length === 0) {
    lines.push("- **Status**: clean (0 violations)");
    lines.push("- **Role Segregation**: verified (all agents conform to role contracts)");
  } else {
    lines.push(`- **Status**: violations detected (${findings.length})`);
    lines.push("- **Findings**:");
    for (const f of findings) {
      lines.push(`  - \`[${f.severity}]\` **${f.role}** (\`${f.agent_id}\`): ${f.observation}`);
      lines.push(`    - *Remediation*: ${f.remediation}`);
    }
  }
  return lines.join("\n");
}
