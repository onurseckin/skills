import type { BrentAnalysisResult, DagTaskNode } from "./types.ts";

export function calculateBrentMetrics(tasks: readonly DagTaskNode[]): BrentAnalysisResult {
  if (tasks.length === 0) {
    return {
      totalWork: 0,
      criticalSpan: 1,
      recommendedProcessors: 1,
      lowerBoundTime: 0,
      upperBoundTime: 0,
      theoreticalSpeedup: 1,
      theoreticalEfficiency: 1,
    };
  }

  const effortMap = new Map<string, number>();
  let totalWork = 0;
  for (const t of tasks) {
    const effort = typeof t.effort === "number" && t.effort > 0 ? t.effort : 1;
    effortMap.set(t.id, effort);
    totalWork += effort;
  }

  const taskMap = new Map<string, DagTaskNode>();
  for (const t of tasks) {
    taskMap.set(t.id, t);
  }

  const spanMemo = new Map<string, number>();
  const visiting = new Set<string>();

  function computeSpan(nodeId: string): number {
    if (spanMemo.has(nodeId)) {
      return spanMemo.get(nodeId)!;
    }
    if (visiting.has(nodeId)) {
      return effortMap.get(nodeId) ?? 1;
    }

    visiting.add(nodeId);
    const task = taskMap.get(nodeId);
    const nodeEffort = effortMap.get(nodeId) ?? 1;
    let maxDepSpan = 0;

    for (const depId of task?.dependencies ?? []) {
      if (taskMap.has(depId)) {
        const depSpan = computeSpan(depId);
        if (depSpan > maxDepSpan) {
          maxDepSpan = depSpan;
        }
      }
    }

    visiting.delete(nodeId);
    const totalNodeSpan = maxDepSpan + nodeEffort;
    spanMemo.set(nodeId, totalNodeSpan);
    return totalNodeSpan;
  }

  let criticalSpan = 1;
  for (const t of tasks) {
    const span = computeSpan(t.id);
    if (span > criticalSpan) {
      criticalSpan = span;
    }
  }

  const recommendedProcessors = Math.max(1, Math.ceil(totalWork / criticalSpan));
  const p = recommendedProcessors;
  const lowerBoundTime = Math.max(Math.ceil(totalWork / p), criticalSpan);
  const upperBoundTime = Math.floor((totalWork - criticalSpan) / p) + criticalSpan;
  const effectiveTime = Math.max(lowerBoundTime, 1);
  const theoreticalSpeedup = Math.round((totalWork / effectiveTime) * 100) / 100;
  const theoreticalEfficiency = Math.round((theoreticalSpeedup / p) * 100) / 100;

  return {
    totalWork,
    criticalSpan,
    recommendedProcessors,
    lowerBoundTime,
    upperBoundTime,
    theoreticalSpeedup,
    theoreticalEfficiency,
  };
}
