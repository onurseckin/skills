import type { DagCheckResult, DagHealResult } from "../../../engine/dag/index.ts";

export function formatDagCheckBrief(res: DagCheckResult, detailed = false): string {
  const lines: string[] = [];
  lines.push("## DAG Engine Health & Diagnostics (`dag:check`)");
  lines.push("");
  lines.push(`- **Status**: ${res.ok ? "✅ HEALTHY" : "❌ DEFECTS DETECTED"}`);
  lines.push(`- **Tasks**: ${res.taskCount} nodes | **Dependencies**: ${res.edgeCount} edges`);
  lines.push(
    `- **Cycles (Tarjan SCC)**: ${
      res.cycles.acyclic ? "None (Acyclic DAG)" : `⚠️ ${res.cycles.cycles.length} cycle(s) found`
    }`,
  );
  lines.push(
    `- **Scope Overlaps**: ${
      res.scopeAudits.length === 0 ? "0 collisions" : `⚠️ ${res.scopeAudits.length} conflict(s)`
    }`,
  );
  lines.push(
    `- **Brent Analysis ($P = \\lceil W/S \\rceil$)**: Total Work $W=${res.brent.totalWork}$, Span $S=${res.brent.criticalSpan}$ -> Recommended Processors $P=${res.brent.recommendedProcessors}$`,
  );
  lines.push(
    `  - Theoretical Bounds: [${res.brent.lowerBoundTime}..${res.brent.upperBoundTime}] | Speedup: ${res.brent.theoreticalSpeedup}x | Efficiency: ${Math.round(res.brent.theoreticalEfficiency * 100)}%`,
  );

  if (res.artificialEdges.length > 0) {
    lines.push(`- **Artificial Serialization Edges**: ${res.artificialEdges.length} detected`);
    for (const edge of res.artificialEdges) {
      lines.push(`  - ${edge.fromTaskId} -> ${edge.toTaskId}: ${edge.reason}`);
    }
  }

  if (detailed && !res.cycles.acyclic) {
    lines.push("");
    lines.push("### Detected Cycles:");
    for (const cycle of res.cycles.cycles) {
      lines.push(`- ${cycle.join(" -> ")}`);
    }
  }

  if (detailed && res.scopeAudits.length > 0) {
    lines.push("");
    lines.push("### Scope Overlap Findings:");
    for (const audit of res.scopeAudits) {
      lines.push(
        `- Conflict between ${audit.taskA} and ${audit.taskB} on path \`${audit.overlapPath}\``,
      );
    }
  }

  return lines.join("\n");
}

export function formatDagHealBrief(res: DagHealResult): string {
  const lines: string[] = [];
  lines.push("## DAG Engine Healing Operations (`dag:heal`)");
  lines.push("");
  lines.push(
    `- **Status**: ${res.healed ? "✅ GRAPH HEALED & DECOUPLED" : "ℹ️ NO CHANGES NEEDED"}`,
  );
  lines.push(`- **Actions Taken**: ${res.actionsTaken.length}`);
  for (const act of res.actionsTaken) {
    lines.push(`  - ${act}`);
  }
  lines.push(`- **Decoupled Waves**: ${res.waves.length}`);
  res.waves.forEach((wave, idx) => {
    lines.push(`  - Wave ${idx + 1}: [${wave.join(", ")}]`);
  });

  return lines.join("\n");
}
