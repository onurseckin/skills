/**
 * Sugiyama Crossing Minimization Engine
 * Implements 2-layer iterative barycenter heuristic sweeps to minimize edge crossings.
 */
import type { SugiyamaEdge, SugiyamaLayer, SugiyamaRankedNode } from "./types.ts";

/**
 * Step 2: Crossing minimization using Barycenter heuristic.
 */
export function minimizeCrossingsBarycenter(
  layers: readonly SugiyamaLayer[],
  edges: readonly SugiyamaEdge[],
  passes = 4,
): SugiyamaLayer[] {
  if (layers.length <= 1) {
    return layers.map((l) => ({ ...l }));
  }

  // Create mutable working layers
  let currentLayers: SugiyamaRankedNode[][] = layers.map((l) => [...l.nodes]);

  const adjDown = new Map<string, string[]>();
  const adjUp = new Map<string, string[]>();

  for (const e of edges) {
    if (!adjDown.has(e.from)) adjDown.set(e.from, []);
    if (!adjUp.has(e.to)) adjUp.set(e.to, []);
    adjDown.get(e.from)?.push(e.to);
    adjUp.get(e.to)?.push(e.from);
  }

  function countCrossingsBetween(
    layerA: readonly SugiyamaRankedNode[],
    layerB: readonly SugiyamaRankedNode[],
  ): number {
    let crossings = 0;
    const posB = new Map<string, number>();
    for (let i = 0; i < layerB.length; i++) {
      const node = layerB[i];
      if (node) {
        posB.set(node.id, i);
      }
    }

    const edgePairs: { aPos: number; bPos: number }[] = [];
    for (let aIdx = 0; aIdx < layerA.length; aIdx++) {
      const uNode = layerA[aIdx];
      if (!uNode) continue;
      const u = uNode.id;
      const targets = adjDown.get(u) ?? [];
      for (const v of targets) {
        const bPosition = posB.get(v);
        if (bPosition !== undefined) {
          edgePairs.push({ aPos: aIdx, bPos: bPosition });
        }
      }
    }

    for (let i = 0; i < edgePairs.length; i++) {
      for (let j = i + 1; j < edgePairs.length; j++) {
        const e1 = edgePairs[i];
        const e2 = edgePairs[j];
        if (!e1 || !e2) continue;
        if ((e1.aPos < e2.aPos && e1.bPos > e2.bPos) || (e1.aPos > e2.aPos && e1.bPos < e2.bPos)) {
          crossings += 1;
        }
      }
    }
    return crossings;
  }

  function totalCrossings(layerList: readonly (readonly SugiyamaRankedNode[])[]): number {
    let total = 0;
    for (let i = 0; i < layerList.length - 1; i++) {
      const layer1 = layerList[i];
      const layer2 = layerList[i + 1];
      if (layer1 && layer2) {
        total += countCrossingsBetween(layer1, layer2);
      }
    }
    return total;
  }

  let bestCrossings = totalCrossings(currentLayers);
  let bestLayers = currentLayers.map((l) => [...l]);

  for (let p = 0; p < passes; p++) {
    // Forward pass (downwards)
    for (let r = 1; r < currentLayers.length; r++) {
      const prevLayer = currentLayers[r - 1];
      const currLayer = currentLayers[r];
      if (!prevLayer || !currLayer) continue;

      const posMap = new Map<string, number>();
      for (let i = 0; i < prevLayer.length; i++) {
        const prevNode = prevLayer[i];
        if (prevNode) {
          posMap.set(prevNode.id, i);
        }
      }

      const barycenters = currLayer.map((node, originalIndex) => {
        const parents = adjUp.get(node.id) ?? [];
        const validPositions = parents
          .map((pId) => posMap.get(pId))
          .filter((pos): pos is number => pos !== undefined);
        const bc =
          validPositions.length > 0
            ? validPositions.reduce((acc, val) => acc + val, 0) / validPositions.length
            : originalIndex;
        return { node, bc, originalIndex };
      });

      barycenters.sort((a, b) => (a.bc !== b.bc ? a.bc - b.bc : a.originalIndex - b.originalIndex));
      currentLayers[r] = barycenters.map((b) => b.node);
    }

    // Backward pass (upwards)
    for (let r = currentLayers.length - 2; r >= 0; r--) {
      const nextLayer = currentLayers[r + 1];
      const currLayer = currentLayers[r];
      if (!nextLayer || !currLayer) continue;

      const posMap = new Map<string, number>();
      for (let i = 0; i < nextLayer.length; i++) {
        const nextNode = nextLayer[i];
        if (nextNode) {
          posMap.set(nextNode.id, i);
        }
      }

      const barycenters = currLayer.map((node, originalIndex) => {
        const children = adjDown.get(node.id) ?? [];
        const validPositions = children
          .map((cId) => posMap.get(cId))
          .filter((pos): pos is number => pos !== undefined);
        const bc =
          validPositions.length > 0
            ? validPositions.reduce((acc, val) => acc + val, 0) / validPositions.length
            : originalIndex;
        return { node, bc, originalIndex };
      });

      barycenters.sort((a, b) => (a.bc !== b.bc ? a.bc - b.bc : a.originalIndex - b.originalIndex));
      currentLayers[r] = barycenters.map((b) => b.node);
    }

    const currentScore = totalCrossings(currentLayers);
    if (currentScore < bestCrossings) {
      bestCrossings = currentScore;
      bestLayers = currentLayers.map((l) => [...l]);
    }
  }

  return bestLayers.map((nodesInRank, rank) => ({
    rank,
    nodes: nodesInRank.map((node, order) => ({
      ...node,
      rank,
      order,
      wave: node.wave ?? rank + 1,
      lane: node.lane ?? order + 1,
      coordinates: node.coordinates ?? {
        wave: node.wave ?? rank + 1,
        lane: node.lane ?? order + 1,
        rank,
        order,
      },
    })),
  }));
}
