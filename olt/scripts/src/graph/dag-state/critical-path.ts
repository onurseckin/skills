import { isRecord } from "../../requirements/predicates.ts";
import type { DagCriticalPathResult } from "./types.ts";

export function computeDagCriticalPath(
  nodes: readonly Record<string, unknown>[],
  edges: readonly Record<string, unknown>[],
): DagCriticalPathResult {
  const taskMap = new Map<string, { effort: number; label: string }>();
  for (const node of nodes) {
    if (isRecord(node) && node.type === "task" && typeof node.id === "string") {
      const effort = typeof node.effort === "number" && node.effort > 0 ? node.effort : 1;
      const label = typeof node.label === "string" ? node.label : node.id;
      taskMap.set(node.id, { effort, label });
    }
  }

  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const taskId of taskMap.keys()) {
    adj.set(taskId, []);
    inDegree.set(taskId, 0);
  }

  for (const edge of edges) {
    if (
      isRecord(edge) &&
      edge.type === "depends_on" &&
      typeof edge.source === "string" &&
      typeof edge.target === "string"
    ) {
      if (taskMap.has(edge.source) && taskMap.has(edge.target)) {
        adj.get(edge.target)?.push(edge.source);
        inDegree.set(edge.source, (inDegree.get(edge.source) ?? 0) + 1);
      }
    }
  }

  const queue: string[] = [];
  for (const [taskId, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(taskId);
  }

  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();

  for (const taskId of taskMap.keys()) {
    dist.set(taskId, taskMap.get(taskId)?.effort ?? 1);
    prev.set(taskId, null);
  }

  while (queue.length > 0) {
    const u = queue.shift()!;
    const uDist = dist.get(u) ?? 0;
    const neighbors = adj.get(u) ?? [];

    for (const v of neighbors) {
      const vEffort = taskMap.get(v)?.effort ?? 1;
      if (uDist + vEffort > (dist.get(v) ?? 0)) {
        dist.set(v, uDist + vEffort);
        prev.set(v, u);
      }
      const newDeg = (inDegree.get(v) ?? 1) - 1;
      inDegree.set(v, newDeg);
      if (newDeg === 0) queue.push(v);
    }
  }

  let maxDist = 0;
  let maxEndNode: string | null = null;
  for (const [taskId, d] of dist.entries()) {
    if (d > maxDist) {
      maxDist = d;
      maxEndNode = taskId;
    }
  }

  const path: string[] = [];
  let curr: string | null = maxEndNode;
  while (curr !== null) {
    path.unshift(curr);
    curr = prev.get(curr) ?? null;
  }

  return {
    criticalPath: path,
    totalEffort: maxDist,
    longestChainLength: path.length,
  };
}
