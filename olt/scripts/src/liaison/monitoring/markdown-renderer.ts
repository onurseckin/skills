import type { MonitoringSnapshot, RenderOptions } from "./types.ts";

/**
 * Renders GitHub Markdown view directly answering:
 * "Is the system working well?" without event log manual parsing.
 */
export function renderMarkdown(snapshot: MonitoringSnapshot, _options?: RenderOptions): string {
  const lines: string[] = [];
  const h = snapshot.health;
  const alertType =
    h.status === "HEALTHY" ? "NOTE" : h.status === "DEGRADED" ? "WARNING" : "CAUTION";

  lines.push(`# Cross-System Monitoring Surface: \`${snapshot.systemId}\``);
  lines.push("");
  lines.push(`> [!${alertType}]`);
  lines.push(
    `> **Status:** ${h.status} | **Score:** ${h.healthScore}/100 | **Working Well:** ${h.isWorkingWell ? "YES" : "NO"}`,
  );
  if (h.concerns.length > 0) {
    lines.push(`>\n> **Concerns:**\n${h.concerns.map((c) => `> - ${c}`).join("\n")}`);
  }
  if (h.recommendations.length > 0) {
    lines.push(`>\n> **Recommendations:**\n${h.recommendations.map((r) => `> - ${r}`).join("\n")}`);
  }
  lines.push("");

  // Liveness
  const liv = snapshot.liveness;
  lines.push("## Liveness");
  lines.push(`- **Status:** \`${liv.status}\``);
  lines.push(
    `- **Heartbeat Age:** ${liv.ageSeconds}s (declared interval: ${liv.declaredIntervalSeconds}s)`,
  );
  lines.push(`- **Missed Beats:** ${liv.consecutiveMissedBeats}`);
  if (liv.statusMessage) {
    lines.push(`- **Status Message:** ${liv.statusMessage}`);
  }
  lines.push("");

  // Roster & Concurrency
  const r = snapshot.roster;
  lines.push("## Roster & Concurrency");
  lines.push("| Metric | Value | Reference |");
  lines.push("| :--- | :--- | :--- |");
  lines.push(
    `| **Distinct Implementers** | \`${r.distinctImplementers}\` | First-class anti-masquerade metric (forensics §2.9) |`,
  );
  lines.push(`| **Lane Count** | \`${r.laneCount}\` | Total active/declared execution lanes |`);
  lines.push(
    `| **Lanes / Implementer Ratio** | \`${r.lanesPerImplementerRatio}\` | Parity ratio (1.00 = ideal parallel) |`,
  );
  lines.push(
    `| **Serial Execution Risk** | \`${r.isSerialExecutionRisk ? "YES" : "NO"}\` | ${r.serialExecutionWarning ?? "Concurrency invariants satisfied"} |`,
  );
  lines.push("");

  lines.push("### Active Agents");
  lines.push("| Agent ID | Role | Lane | Status |");
  lines.push("| :--- | :--- | :--- | :--- |");
  for (const a of r.activeAgents) {
    lines.push(
      `| \`${a.agentId}\` | ${a.roleType} | ${a.laneId ? `\`${a.laneId}\`` : "—"} | ${a.status} |`,
    );
  }
  lines.push("");

  // Obligations
  const ob = snapshot.obligations;
  lines.push("## Obligations & Protocol Binding");
  lines.push(
    `**Summary:** ${ob.totalObligations} total, ${ob.boundCount} bound, ${ob.refusedCount} refused, ${ob.overdueCount} overdue.`,
  );
  lines.push("");
  lines.push("| Directive ID | Correlation ID | State | Named Paths | Details / Proof |");
  lines.push("| :--- | :--- | :--- | :--- | :--- |");
  for (const item of ob.obligations) {
    const paths = item.directive.namedPaths.length > 0 ? item.directive.namedPaths.join(", ") : "—";
    const details = item.refusalReason
      ? `Refusal: ${item.refusalReason}`
      : item.proof?.taskId
        ? `Task: \`${item.proof.taskId}\``
        : "—";
    lines.push(
      `| \`${item.directive.directiveId}\` | \`${item.directive.correlationId}\` | **${item.bindingState.toUpperCase()}** | \`${paths}\` | ${details} |`,
    );
  }
  lines.push("");

  // Run State
  if (snapshot.runState) {
    const run = snapshot.runState;
    lines.push("## Run State");
    lines.push(`- **Run ID:** \`${run.runId}\` (${run.status})`);
    lines.push(
      `- **Total Lanes:** ${run.totalLanes} (Unclaimed: ${run.unclaimedReadyLanes.length})`,
    );
    lines.push("");
    lines.push("| Lane ID | Status | Lease Holder | Write Scope |");
    lines.push("| :--- | :--- | :--- | :--- |");
    for (const lane of run.lanes) {
      const holder = lane.leaseHolder ? `\`${lane.leaseHolder}\`` : "—";
      const scopes = lane.writeScope.length > 0 ? lane.writeScope.join(", ") : "—";
      lines.push(`| \`${lane.laneId}\` | ${lane.status} | ${holder} | \`${scopes}\` |`);
    }
    lines.push("");
  }

  // Shared Metrics
  if (snapshot.sharedMetrics.length > 0) {
    lines.push("## Shared Metrics (Single Computed Truth)");
    lines.push("| Metric Name | Value | Computation Definition | Authority |");
    lines.push("| :--- | :--- | :--- | :--- |");
    for (const m of snapshot.sharedMetrics) {
      const val = `${String(m.value)}${m.unit ? ` ${m.unit}` : ""}`;
      lines.push(
        `| \`${m.name}\` | **${val}** | \`${m.computationDefinition}\` | ${m.authority} |`,
      );
    }
    lines.push("");
  }

  // Drift
  if (snapshot.drift.length > 0) {
    lines.push("## Ratchet & Gate Drift");
    lines.push("| Metric | Baseline | Current | Delta | Direction | Status |");
    lines.push("| :--- | :--- | :--- | :--- | :--- | :--- |");
    for (const d of snapshot.drift) {
      const statusStr = d.isRegression
        ? d.absorbedRegressionAllowed
          ? "Absorbed"
          : "REGRESSION"
        : "OK";
      lines.push(
        `| \`${d.metricName}\` | ${d.baselineValue} | ${d.currentValue} | ${d.delta > 0 ? `+${d.delta}` : d.delta} | ${d.direction} | **${statusStr}** |`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}
