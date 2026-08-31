import type { MultiCapsuleSummary } from "./types.ts";

export function formatMultiCapsuleMarkdownSummary(summary: MultiCapsuleSummary): string {
  const statusIcon =
    summary.overallStatus === "converged"
      ? "🟢 CONVERGED"
      : summary.overallStatus === "partial"
        ? "🟡 PARTIAL"
        : summary.overallStatus === "cancelled"
          ? "⚪ CANCELLED"
          : "🔴 FAILED";

  const lines: string[] = [
    "# Multi-Capsule Parallel Orchestration Summary",
    "",
    `**Overall Status**: ${statusIcon}`,
    `**Duration**: ${(summary.durationMs / 1000).toFixed(2)}s`,
    `**Concurrency Limit**: ${summary.concurrencyLimit}`,
    `**Total Capsules**: ${summary.totalCapsules} | **Converged**: ${summary.convergedCount} | **Failed**: ${summary.failedCount} | **Blocked**: ${summary.blockedCount} | **Cancelled**: ${summary.cancelledCount}`,
    "",
    "## Anti-Sequentiality Audit",
    `- **Compliant**: ${summary.antiSequentialityReport.compliant ? "✅ Yes" : "❌ No"}`,
    `- **Parallelism Speedup Ratio**: ${summary.antiSequentialityReport.parallelismRatio.toFixed(2)}x`,
    `- **Critical Path Waves**: ${summary.antiSequentialityReport.criticalPathLength}`,
    `- **Independent Lanes**: ${summary.antiSequentialityReport.independentLanesCount}`,
    "",
  ];

  if (summary.antiSequentialityReport.violations.length > 0) {
    lines.push("### Detected Anti-Sequentiality Violations");
    for (const v of summary.antiSequentialityReport.violations) {
      lines.push(`- **[${v.type}]** Capsules: \`${v.capsuleIds.join(", ")}\``);
      lines.push(`  - *Issue*: ${v.message}`);
      lines.push(`  - *Remedy*: ${v.remedy}`);
    }
    lines.push("");
  }

  lines.push("## Capsule Execution Table");
  lines.push("| Capsule ID | Status | Duration | Gate | Summary |");
  lines.push("| :--- | :--- | :--- | :--- | :--- |");

  for (const [id, res] of Object.entries(summary.results)) {
    const gateCol = res.gatePassed === undefined ? "N/A" : res.gatePassed ? "✅ Pass" : "❌ Fail";
    let sumCol = "Completed";
    if (res.summary !== undefined) {
      sumCol = res.summary.replace(/\|/g, "\\|");
    } else if (res.error !== undefined) {
      sumCol = res.error;
    }
    lines.push(
      `| \`${id}\` | **${res.status.toUpperCase()}** | ${(res.durationMs / 1000).toFixed(2)}s | ${gateCol} | ${sumCol} |`,
    );
  }

  lines.push("");

  if (summary.companionPairing !== undefined) {
    lines.push("## Companion Skill Auditor");
    lines.push(`- **Paired**: ${summary.companionPairing.paired ? "✅ Yes" : "❌ No"}`);
    lines.push(`- **Companion Agent**: \`${summary.companionPairing.companionAgentId}\``);
    lines.push(
      `- **Auto-Provisioned**: ${summary.companionPairing.autoProvisioned ? "Yes" : "No"}`,
    );
    lines.push("");
  }

  if (summary.behavioralForensicsSummary !== undefined) {
    lines.push("## Behavioral Forensics Summary");
    lines.push(
      `- **Compliant**: ${summary.behavioralForensicsSummary.compliant ? "✅ Yes" : "❌ No"}`,
    );
    lines.push(
      `- **Token Burning Incidents**: ${summary.behavioralForensicsSummary.tokenBurningCount}`,
    );
    lines.push(
      `- **False Serialization Bottlenecks**: ${summary.behavioralForensicsSummary.falseSerializationCount}`,
    );
    lines.push(
      `- **Role Boundary Deviations**: ${summary.behavioralForensicsSummary.roleBoundaryDeviationsCount}`,
    );
    lines.push("");
  }

  return lines.join("\n");
}
