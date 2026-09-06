import { calculateBrentMetrics } from "./brent.ts";
import { detectCyclesTarjan } from "./scc.ts";
import { auditScopeOverlaps } from "./scope-audit.ts";
import { detectArtificialSerializationEdges } from "./serialization.ts";
import type { DagCheckResult, DagTaskNode } from "./types.ts";

export function checkDag(tasks: readonly DagTaskNode[]): DagCheckResult {
  const cycles = detectCyclesTarjan(tasks);
  const scopeAudits = auditScopeOverlaps(tasks);
  const brent = calculateBrentMetrics(tasks);
  const artificialEdges = detectArtificialSerializationEdges(tasks);

  let edgeCount = 0;
  for (const t of tasks) {
    edgeCount += t.dependencies.length;
  }

  const ok = cycles.acyclic && scopeAudits.length === 0;

  return {
    ok,
    taskCount: tasks.length,
    edgeCount,
    cycles,
    scopeAudits,
    brent,
    artificialEdges,
  };
}
