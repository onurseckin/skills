/**
 * Sugiyama Layered Ranking Engine
 * Computes topological / longest-path rank levels for DAG nodes.
 */
import type { SugiyamaEdge, SugiyamaNode } from "./types.ts";

/**
 * Step 1: Assign nodes to discrete rank layers using longest-path leveling.
 */
export function assignSugiyamaRanks(
  nodes: readonly SugiyamaNode[],
  edges: readonly SugiyamaEdge[],
  cycleNodeIds: readonly string[] = [],
): Map<string, number> {
  const rankMap = new Map<string, number>();
  const cycleSet = new Set(cycleNodeIds);

  // Filter out cycle back-edges to calculate ranks safely
  const acyclicEdges = edges.filter(
    (e) => !cycleSet.has(e.from) || !cycleSet.has(e.to) || e.from === e.to,
  );

  // In-degree computation
  const inDegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const n of nodes) {
    inDegree.set(n.id, 0);
    outgoing.set(n.id, []);
    rankMap.set(n.id, 0);
  }

  for (const e of acyclicEdges) {
    if (e.from === e.to) continue;
    if (inDegree.has(e.to) && outgoing.has(e.from)) {
      inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
      outgoing.get(e.from)?.push(e.to);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) {
      queue.push(id);
      rankMap.set(id, 0);
    }
  }

  const visited = new Set<string>();
  while (queue.length > 0) {
    const curr = queue.shift()!;
    visited.add(curr);
    const currRank = rankMap.get(curr) ?? 0;
    const children = outgoing.get(curr) ?? [];

    for (const child of children) {
      const existingRank = rankMap.get(child) ?? 0;
      if (currRank + 1 > existingRank) {
        rankMap.set(child, currRank + 1);
      }
      const remainingDeg = (inDegree.get(child) ?? 1) - 1;
      inDegree.set(child, remainingDeg);
      if (remainingDeg === 0) {
        queue.push(child);
      }
    }
  }

  // Handle any remaining nodes in cycles or disconnected components
  for (const n of nodes) {
    if (!visited.has(n.id)) {
      let maxParentRank = -1;
      for (const e of edges) {
        if (e.to === n.id && e.from !== n.id) {
          const pRank = rankMap.get(e.from) ?? 0;
          if (pRank > maxParentRank) {
            maxParentRank = pRank;
          }
        }
      }
      rankMap.set(n.id, maxParentRank >= 0 ? maxParentRank + 1 : 0);
    }
  }

  return rankMap;
}
