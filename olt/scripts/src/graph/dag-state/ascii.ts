import { isRecord } from "../../requirements/predicates.ts";
import type { UnifiedPlanResult } from "../unified-plan.ts";
import type { DynamicDagState } from "./types.ts";

export function formatDynamicDagAscii(
  input: DynamicDagState | UnifiedPlanResult | Record<string, unknown>,
): string {
  const lines: string[] = [];

  if ("executionSummary" in input && "waves" in input) {
    const dag = input as DynamicDagState;
    lines.push(`=== Dynamic Living DAG State (Revision ${dag.revision}) ===`);
    lines.push(
      `Tasks: ${dag.executionSummary.totalTasks} (Done: ${dag.executionSummary.doneTasks}, Leased: ${dag.executionSummary.leasedTasks}, Ready: ${dag.executionSummary.readyTasks})`,
    );
    lines.push(
      `Active Agents: ${dag.executionSummary.activeAgentsCount}, Total Events: ${dag.totalEvents}`,
    );
    lines.push(`Critical Path: ${dag.criticalPath.join(" -> ") || "none"}`);
    lines.push("");
    lines.push("Concurrency Waves:");
    for (const wave of dag.waves) {
      lines.push(`  Wave ${wave.waveIndex}: [ ${wave.tasks.join(" | ")} ]`);
    }
  } else if ("topology" in input && "graphDocument" in input) {
    const plan = input as UnifiedPlanResult;
    const rev = typeof plan.graphDocument.revision === "number" ? plan.graphDocument.revision : 1;
    lines.push(`=== Unified High-Leverage Plan DAG (Revision ${rev}) ===`);
    lines.push(
      `Parallel Metrics: Factor = ${plan.topology.metrics.parallelismFactor}, Optimal Lanes = ${plan.topology.metrics.optimalLanes}`,
    );
    lines.push("Topological Waves:");
    for (const wave of plan.topology.waves) {
      lines.push(`  Wave ${wave.waveIndex}: [ ${wave.tasks.join(" | ")} ]`);
    }
  } else if (isRecord(input) && Array.isArray(input.nodes)) {
    const nodes = input.nodes as Record<string, unknown>[];
    const taskNodes = nodes.filter((n) => isRecord(n) && n.type === "task");
    lines.push(`=== Plan Graph DAG (${taskNodes.length} tasks) ===`);
    for (const task of taskNodes) {
      const id = typeof task.id === "string" ? task.id : "unknown";
      const label = typeof task.label === "string" ? task.label : id;
      const role = typeof task.role === "string" ? task.role : "implementer";
      const status = typeof task.status === "string" ? task.status : "ready";
      lines.push(`- [${status.toUpperCase()}] ${id} (${role}): ${label}`);
    }
  } else {
    lines.push("=== Dynamic DAG Overview ===");
  }

  return lines.join("\n");
}
