/**
 * Sugiyama Layered Ranking & Coffman-Graham Width Bounding Engine
 * Computes topological / longest-path rank levels and width-bounded layer schedules.
 * Strictly 0 any and strictly typed.
 */
import type { SugiyamaEdge, SugiyamaNode } from "./types.ts";

/**
 * Computes deterministic lexicographical labels lambda(v) in {1, ..., |V|} for Coffman-Graham scheduling.
 * Sinks (nodes with no successors) are labeled first.
 * For each eligible candidate node (all successors already labeled), its successor labels are sorted descending,
 * and the candidate with the lexicographically smallest list is chosen next.
 * Ties are broken deterministically by node ID.
 */
export function computeLexicographicLabels(
  nodes: readonly SugiyamaNode[],
  edges: readonly SugiyamaEdge[],
): Map<string, number> {
  const labelMap = new Map<string, number>();
  if (nodes.length === 0) {
    return labelMap;
  }

  const nodeIds = new Set<string>(nodes.map((n) => n.id));
  const successors = new Map<string, Set<string>>();
  for (const n of nodes) {
    successors.set(n.id, new Set<string>());
  }

  for (const e of edges) {
    if (e.from === e.to) continue;
    if (nodeIds.has(e.from) && nodeIds.has(e.to)) {
      successors.get(e.from)?.add(e.to);
    }
  }

  const unassigned = new Set<string>(nodeIds);

  const getSuccessorLabels = (nodeId: string): readonly number[] => {
    const succs = successors.get(nodeId);
    if (!succs || succs.size === 0) {
      return [];
    }
    const list: number[] = [];
    for (const s of succs) {
      const lbl = labelMap.get(s);
      if (lbl !== undefined) {
        list.push(lbl);
      }
    }
    return list.sort((a, b) => b - a);
  };

  const compareLexicographic = (aId: string, bId: string): number => {
    const aLabels = getSuccessorLabels(aId);
    const bLabels = getSuccessorLabels(bId);
    const minLen = Math.min(aLabels.length, bLabels.length);

    for (let k = 0; k < minLen; k++) {
      const diff = (aLabels[k] ?? 0) - (bLabels[k] ?? 0);
      if (diff !== 0) {
        return diff;
      }
    }

    if (aLabels.length !== bLabels.length) {
      return aLabels.length - bLabels.length;
    }

    return aId.localeCompare(bId);
  };

  for (let step = 1; step <= nodes.length; step++) {
    const eligible: string[] = [];
    for (const u of unassigned) {
      const succs = successors.get(u);
      let allAssigned = true;
      if (succs) {
        for (const v of succs) {
          if (!labelMap.has(v)) {
            allAssigned = false;
            break;
          }
        }
      }
      if (allAssigned) {
        eligible.push(u);
      }
    }

    // In case of cycles, fallback to remaining unassigned nodes
    const pool = eligible.length > 0 ? eligible : [...unassigned];
    pool.sort(compareLexicographic);

    const chosen = pool[0];
    if (chosen !== undefined) {
      labelMap.set(chosen, step);
      unassigned.delete(chosen);
    }
  }

  return labelMap;
}

/**
 * Partitions nodes into discrete layers bounded by maxWidth (default: 4),
 * guaranteeing |L_k| <= maxWidth and for all edges (u, v), layer(v) > layer(u).
 */
export function boundLayerWidthCoffmanGraham(
  nodes: readonly SugiyamaNode[],
  edges: readonly SugiyamaEdge[],
  maxWidth: number = 4,
): Map<string, number> {
  const rankMap = new Map<string, number>();
  if (nodes.length === 0) {
    return rankMap;
  }
  if (nodes.length === 1) {
    const first = nodes[0];
    if (first !== undefined) {
      rankMap.set(first.id, 0);
    }
    return rankMap;
  }

  const limit = Math.max(1, Math.floor(maxWidth));
  const nodeIds = new Set<string>(nodes.map((n) => n.id));
  const predecessors = new Map<string, Set<string>>();
  for (const n of nodes) {
    predecessors.set(n.id, new Set<string>());
  }

  for (const e of edges) {
    if (e.from === e.to) continue;
    if (nodeIds.has(e.from) && nodeIds.has(e.to)) {
      predecessors.get(e.to)?.add(e.from);
    }
  }

  const labels = computeLexicographicLabels(nodes, edges);

  // Consider vertices in decreasing order of their labels lambda(v)
  const sortedNodes = [...nodes].sort((a, b) => {
    const lA = labels.get(a.id) ?? 0;
    const lB = labels.get(b.id) ?? 0;
    return lB - lA;
  });

  const layerSizes: number[] = [];

  for (const u of sortedNodes) {
    let minLayer = 0;
    const preds = predecessors.get(u.id);
    if (preds && preds.size > 0) {
      for (const p of preds) {
        const pRank = rankMap.get(p);
        if (pRank !== undefined) {
          minLayer = Math.max(minLayer, pRank + 1);
        }
      }
    }

    let assignedLayer = minLayer;
    while ((layerSizes[assignedLayer] ?? 0) >= limit) {
      assignedLayer++;
    }

    rankMap.set(u.id, assignedLayer);
    layerSizes[assignedLayer] = (layerSizes[assignedLayer] ?? 0) + 1;
  }

  return rankMap;
}

/**
 * Step 1: Assign nodes to discrete rank layers.
 * If maxWidth is provided, applies Coffman-Graham width bounding;
 * otherwise computes topological longest-path leveling.
 */
export function assignSugiyamaRanks(
  nodes: readonly SugiyamaNode[],
  edges: readonly SugiyamaEdge[],
  cycleNodeIds: readonly string[] = [],
  maxWidth?: number,
): Map<string, number> {
  const cycleSet = new Set<string>(cycleNodeIds);

  // Filter out cycle back-edges to calculate ranks safely
  const acyclicEdges = edges.filter(
    (e) => !cycleSet.has(e.from) || !cycleSet.has(e.to) || e.from === e.to,
  );

  if (maxWidth !== undefined && maxWidth > 0) {
    return boundLayerWidthCoffmanGraham(nodes, acyclicEdges, maxWidth);
  }

  const rankMap = new Map<string, number>();

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
