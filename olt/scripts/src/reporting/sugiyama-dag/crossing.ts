import type { SugiyamaEdge, SugiyamaLayer, SugiyamaRankedNode } from "./types.ts";

export function countLayerCrossings(
  layerA: readonly SugiyamaRankedNode[],
  layerB: readonly SugiyamaRankedNode[],
  edges: readonly SugiyamaEdge[],
): number {
  if (layerA.length <= 1 || layerB.length <= 1 || edges.length <= 1) {
    return 0;
  }

  const posA = new Map<string, number>();
  for (let i = 0; i < layerA.length; i++) {
    const node = layerA[i];
    if (node !== undefined) {
      posA.set(node.id, i);
    }
  }

  const posB = new Map<string, number>();
  for (let i = 0; i < layerB.length; i++) {
    const node = layerB[i];
    if (node !== undefined) {
      posB.set(node.id, i);
    }
  }

  const edgePairs: { readonly aPos: number; readonly bPos: number }[] = [];
  for (const edge of edges) {
    const aPos = posA.get(edge.from);
    const bPos = posB.get(edge.to);
    if (aPos !== undefined && bPos !== undefined) {
      edgePairs.push({ aPos, bPos });
    }
  }

  let crossings = 0;
  for (let i = 0; i < edgePairs.length; i++) {
    const e1 = edgePairs[i];
    if (e1 === undefined) continue;
    for (let j = i + 1; j < edgePairs.length; j++) {
      const e2 = edgePairs[j];
      if (e2 === undefined) continue;
      if ((e1.aPos < e2.aPos && e1.bPos > e2.bPos) || (e1.aPos > e2.aPos && e1.bPos < e2.bPos)) {
        crossings += 1;
      }
    }
  }

  return crossings;
}

function computeTotalGraphCrossings(
  layers: readonly (readonly SugiyamaRankedNode[])[],
  edges: readonly SugiyamaEdge[],
): number {
  let total = 0;
  for (let i = 0; i < layers.length - 1; i++) {
    const layer1 = layers[i];
    const layer2 = layers[i + 1];
    if (layer1 !== undefined && layer2 !== undefined) {
      total += countLayerCrossings(layer1, layer2, edges);
    }
  }
  return total;
}

function formatRankedNode(
  node: SugiyamaRankedNode,
  rank: number,
  order: number,
): SugiyamaRankedNode {
  const wave = node.wave ?? rank + 1;
  const lane = node.lane ?? order + 1;
  const coordinates =
    typeof node.coordinates === "object" &&
    node.coordinates !== null &&
    !Array.isArray(node.coordinates)
      ? {
          ...node.coordinates,
          rank,
          order,
          wave: node.coordinates.wave ?? wave,
          lane: node.coordinates.lane ?? lane,
        }
      : (node.coordinates ?? {
          wave,
          lane,
          rank,
          order,
        });

  return {
    ...node,
    rank,
    order,
    wave,
    lane,
    coordinates,
  };
}

export function barycentricSort(
  layer: readonly SugiyamaRankedNode[],
  refLayer: readonly SugiyamaRankedNode[],
  edges: readonly SugiyamaEdge[],
  direction: "down" | "up",
): SugiyamaRankedNode[] {
  if (layer.length <= 1) {
    return layer.map((node, order) => formatRankedNode(node, node.rank, order));
  }

  const refPosMap = new Map<string, number>();
  for (let i = 0; i < refLayer.length; i++) {
    const refNode = refLayer[i];
    if (refNode !== undefined) {
      refPosMap.set(refNode.id, i);
    }
  }

  const adjMap = new Map<string, string[]>();
  for (const edge of edges) {
    if (direction === "down") {
      if (refPosMap.has(edge.from)) {
        let targets = adjMap.get(edge.to);
        if (targets === undefined) {
          targets = [];
          adjMap.set(edge.to, targets);
        }
        targets.push(edge.from);
      }
    } else {
      if (refPosMap.has(edge.to)) {
        let sources = adjMap.get(edge.from);
        if (sources === undefined) {
          sources = [];
          adjMap.set(edge.from, sources);
        }
        sources.push(edge.to);
      }
    }
  }

  interface BarycenterEntry {
    readonly node: SugiyamaRankedNode;
    readonly centroid: number;
    readonly originalIndex: number;
  }

  const entries: BarycenterEntry[] = layer.map((node, originalIndex) => {
    const neighbors = adjMap.get(node.id) ?? [];
    const validPositions = neighbors
      .map((nId) => refPosMap.get(nId))
      .filter((pos): pos is number => pos !== undefined);

    const centroid =
      validPositions.length > 0
        ? validPositions.reduce((acc, pos) => acc + pos, 0) / validPositions.length
        : originalIndex;

    return { node, centroid, originalIndex };
  });

  entries.sort((a, b) => {
    if (a.centroid !== b.centroid) {
      return a.centroid - b.centroid;
    }
    if (a.originalIndex !== b.originalIndex) {
      return a.originalIndex - b.originalIndex;
    }
    return a.node.id.localeCompare(b.node.id);
  });

  return entries.map((entry, order) => formatRankedNode(entry.node, entry.node.rank, order));
}

export function minimizeCrossingsBarycenter(
  layers: readonly SugiyamaLayer[],
  edges: readonly SugiyamaEdge[],
  passes = 4,
): SugiyamaLayer[] {
  if (layers.length <= 1) {
    return layers.map((layer, rank) => ({
      rank,
      nodes: layer.nodes.map((node, order) => formatRankedNode(node, rank, order)),
    }));
  }

  let currentLayers: SugiyamaRankedNode[][] = layers.map((layer, rank) =>
    layer.nodes.map((node, order) => formatRankedNode(node, rank, order)),
  );

  let bestCrossings = computeTotalGraphCrossings(currentLayers, edges);
  let bestLayers: SugiyamaRankedNode[][] = currentLayers.map((l) => [...l]);

  const numPasses = Math.max(1, passes);
  for (let p = 0; p < numPasses; p++) {
    for (let r = 1; r < currentLayers.length; r++) {
      const prevLayer = currentLayers[r - 1];
      const currLayer = currentLayers[r];
      if (prevLayer !== undefined && currLayer !== undefined) {
        currentLayers[r] = barycentricSort(currLayer, prevLayer, edges, "down");
      }
    }

    for (let r = currentLayers.length - 2; r >= 0; r--) {
      const nextLayer = currentLayers[r + 1];
      const currLayer = currentLayers[r];
      if (nextLayer !== undefined && currLayer !== undefined) {
        currentLayers[r] = barycentricSort(currLayer, nextLayer, edges, "up");
      }
    }

    const currentCrossings = computeTotalGraphCrossings(currentLayers, edges);
    if (currentCrossings < bestCrossings) {
      bestCrossings = currentCrossings;
      bestLayers = currentLayers.map((l) => [...l]);
    }
  }

  return bestLayers.map((nodesInRank, rank) => ({
    rank,
    nodes: nodesInRank.map((node, order) => formatRankedNode(node, rank, order)),
  }));
}
