import type { MonitoringSnapshot, RenderOptions } from "./types.ts";

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
} as const;

function colorize(text: string, color: string, enabled: boolean): string {
  return enabled ? `${color}${text}${ANSI.reset}` : text;
}

/**
 * Renders terminal CLI view with ANSI formatting directly answering:
 * "Is the system working well?" without event log manual parsing.
 */
export function renderCli(snapshot: MonitoringSnapshot, options?: RenderOptions): string {
  const c = options?.includeAnsiColors ?? true;
  const lines: string[] = [];

  const h = snapshot.health;
  const statusColor =
    h.status === "HEALTHY" ? ANSI.green : h.status === "DEGRADED" ? ANSI.yellow : ANSI.red;

  lines.push(colorize(`=== CROSS-SYSTEM MONITORING: ${snapshot.systemId} ===`, ANSI.bold, c));
  lines.push(
    `Health: ${colorize(`[${h.status}]`, statusColor, c)} (Score: ${h.healthScore}/100) | Working Well: ${
      h.isWorkingWell ? colorize("YES", ANSI.green, c) : colorize("NO", ANSI.red, c)
    }`,
  );

  if (h.concerns.length > 0) {
    lines.push(colorize("Concerns:", ANSI.yellow, c));
    for (const item of h.concerns) {
      lines.push(`  ! ${item}`);
    }
  }
  if (h.recommendations.length > 0) {
    lines.push(colorize("Recommendations:", ANSI.cyan, c));
    for (const item of h.recommendations) {
      lines.push(`  -> ${item}`);
    }
  }

  // Liveness
  const liv = snapshot.liveness;
  const livColor = liv.status === "ALIVE" ? ANSI.green : ANSI.red;
  lines.push("");
  lines.push(colorize("--- LIVENESS ---", ANSI.bold, c));
  lines.push(
    `Status: ${colorize(liv.status, livColor, c)} | Heartbeat Age: ${liv.ageSeconds}s | Declared Interval: ${liv.declaredIntervalSeconds}s | Missed Beats: ${liv.consecutiveMissedBeats}`,
  );
  if (liv.statusMessage) {
    lines.push(`Message: ${liv.statusMessage}`);
  }

  // Roster & Concurrency
  const r = snapshot.roster;
  lines.push("");
  lines.push(colorize("--- ROSTER & CONCURRENCY ---", ANSI.bold, c));
  lines.push(
    `Distinct Implementers: ${colorize(String(r.distinctImplementers), ANSI.bold, c)} | Lane Count: ${r.laneCount} | Ratio: ${r.lanesPerImplementerRatio}`,
  );
  if (r.isSerialExecutionRisk) {
    lines.push(colorize(`[WARNING] ${r.serialExecutionWarning}`, ANSI.red, c));
  } else {
    lines.push(colorize("[OK] Concurrency healthy: parallel lanes protected.", ANSI.green, c));
  }
  lines.push(`Active Agents (${r.totalActiveAgents}):`);
  for (const agent of r.activeAgents) {
    const laneStr = agent.laneId ? ` (lane: ${agent.laneId})` : "";
    lines.push(`  * ${agent.agentId} [${agent.roleType}]${laneStr} - ${agent.status}`);
  }

  // Obligations
  const ob = snapshot.obligations;
  lines.push("");
  lines.push(colorize("--- OBLIGATIONS ---", ANSI.bold, c));
  lines.push(
    `Total: ${ob.totalObligations} | Bound: ${ob.boundCount} | Refused: ${ob.refusedCount} | Overdue: ${ob.overdueCount} | Open: ${ob.openCount}`,
  );
  for (const item of ob.obligations) {
    const stateColor =
      item.bindingState === "bound"
        ? ANSI.green
        : item.bindingState === "overdue"
          ? ANSI.red
          : item.bindingState === "refused"
            ? ANSI.yellow
            : ANSI.cyan;
    const pathsStr =
      item.directive.namedPaths.length > 0
        ? ` [paths: ${item.directive.namedPaths.join(", ")}]`
        : "";
    lines.push(
      `  [${colorize(item.bindingState.toUpperCase(), stateColor, c)}] id: ${item.directive.directiveId} | corr: ${item.directive.correlationId}${pathsStr}`,
    );
    if (item.refusalReason) {
      lines.push(`     Refusal: ${item.refusalReason}`);
    }
    if (item.proof?.taskId) {
      lines.push(`     Bound Task: ${item.proof.taskId}`);
    }
  }

  // Run State
  if (snapshot.runState) {
    const run = snapshot.runState;
    lines.push("");
    lines.push(colorize("--- RUN STATE ---", ANSI.bold, c));
    lines.push(`Run ID: ${run.runId} | Status: ${run.status} | Lanes: ${run.totalLanes}`);
    if (run.unclaimedReadyLanes.length > 0) {
      lines.push(
        colorize(`  Unclaimed Lanes: ${run.unclaimedReadyLanes.join(", ")}`, ANSI.yellow, c),
      );
    }
    for (const lane of run.lanes) {
      const holderStr = lane.leaseHolder ? ` (holder: ${lane.leaseHolder})` : " (unassigned)";
      lines.push(`  * ${lane.laneId} [${lane.status}]${holderStr}`);
    }
  }

  // Shared Metrics
  if (snapshot.sharedMetrics.length > 0) {
    lines.push("");
    lines.push(colorize("--- SHARED METRICS (Single Computed Truth) ---", ANSI.bold, c));
    for (const m of snapshot.sharedMetrics) {
      const unitStr = m.unit ? ` ${m.unit}` : "";
      lines.push(`  * ${m.name} = ${String(m.value)}${unitStr} (authority: ${m.authority})`);
      lines.push(`    Def: ${m.computationDefinition}`);
    }
  }

  // Drift
  if (snapshot.drift.length > 0) {
    lines.push("");
    lines.push(colorize("--- DRIFT & RATCHETS ---", ANSI.bold, c));
    for (const d of snapshot.drift) {
      const dirColor =
        d.direction === "improved" ? ANSI.green : d.isRegression ? ANSI.red : ANSI.gray;
      lines.push(
        `  * ${d.metricName}: ${d.baselineValue} -> ${d.currentValue} (delta: ${d.delta}) [${colorize(d.direction.toUpperCase(), dirColor, c)}]`,
      );
    }
  }

  return lines.join("\n");
}
