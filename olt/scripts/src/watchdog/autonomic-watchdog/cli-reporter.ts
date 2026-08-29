import type { WatchdogHealthAuditReport } from "./types.ts";

export function formatCliStatusReport(
  health: WatchdogHealthAuditReport,
  bootGateTable: string,
): string {
  const lines: string[] = [
    "### Autonomic Watchdog Status & Boot-Gate Enforcer",
    `- **Overall Health**: ${health.healthy ? "HEALTHY ✅" : "UNHEALTHY ❌"}`,
    `- **Active Leases / Monitors**: ${health.activeLeasesCount}`,
    `- **Stalled Agents**: ${health.stalledAgentsCount}`,
    `- **Dead / Terminated Processes**: ${health.deadProcessesCount}`,
    `- **Subagent Count**: ${health.subagentCount}`,
    `- **Boot-Gate Compliant**: ${health.bootGateCompliantCount}/${health.subagentCount}`,
    `- **Tier Violations**: ${health.tierViolationsCount}`,
    `- **Summary**: ${health.summary}`,
    "",
    "#### Subagent Pre-Flight Boot-Gate Status",
    bootGateTable,
  ];

  if (health.findings.length > 0) {
    lines.push("");
    lines.push("#### Active Watchdog Findings");
    for (const f of health.findings) {
      lines.push(`- [${f.severity.toUpperCase()}] **${f.violationType}**: ${f.observation}`);
    }
  }

  return lines.join("\n");
}
