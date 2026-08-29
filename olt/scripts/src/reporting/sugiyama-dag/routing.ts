/**
 * Sugiyama Orthogonal Routing Engine
 * Renders orthogonal ASCII / Unicode grid routes and connectors between waves and lanes.
 */
import type { SugiyamaEdge, SugiyamaLayer, SugiyamaRankedNode } from "./types.ts";

export interface OrthogonalRouteSegment {
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly fromWave: number;
  readonly toWave: number;
  readonly fromLane: number;
  readonly toLane: number;
}

/**
 * Builds routing segments for edges traversing layers.
 */
export function buildOrthogonalRouteSegments(
  edges: readonly SugiyamaEdge[],
  nodeMap: ReadonlyMap<string, SugiyamaRankedNode>,
): OrthogonalRouteSegment[] {
  const segments: OrthogonalRouteSegment[] = [];

  for (const edge of edges) {
    const fromNode = nodeMap.get(edge.from);
    const toNode = nodeMap.get(edge.to);
    if (!fromNode || !toNode) continue;

    segments.push({
      fromNodeId: edge.from,
      toNodeId: edge.to,
      fromWave: fromNode.rank + 1,
      toWave: toNode.rank + 1,
      fromLane: fromNode.order + 1,
      toLane: toNode.order + 1,
    });
  }

  return segments;
}

/**
 * Renders inter-wave orthogonal connector lines between layers.
 */
export function renderInterWaveConnector(
  fromLayer: SugiyamaLayer,
  toLayer: SugiyamaLayer,
  edges: readonly SugiyamaEdge[],
  indent = 30,
): string[] {
  const fromIds = new Set(fromLayer.nodes.map((n) => n.id));
  const toIds = new Set(toLayer.nodes.map((n) => n.id));

  const relevantEdges = edges.filter((e) => fromIds.has(e.from) && toIds.has(e.to));
  if (relevantEdges.length === 0) {
    // Standard downward flow
    return [
      `${" ".repeat(indent)}│`,
      `${" ".repeat(indent)}▼`,
    ];
  }

  if (fromLayer.nodes.length === 1 && toLayer.nodes.length === 1) {
    return [
      `${" ".repeat(indent)}│`,
      `${" ".repeat(indent)}▼`,
    ];
  }

  // Multi-lane fan-in / fan-out orthogonal channel
  const padding = " ".repeat(Math.max(0, indent - 6));
  return [
    `${padding}      │`,
    `${padding}──┬───┴───┬── ──▶ [W${toLayer.rank + 1} PARALLEL CHANNEL]`,
    `${padding}  ▼       ▼`,
  ];
}

/**
 * Renders intra-wave parallel lane separator.
 */
export function renderLaneSeparator(indent = 30): string[] {
  const padding = " ".repeat(Math.max(0, indent - 6));
  return [
    `${" ".repeat(indent)}│`,
    `${padding}──┬── ──▶ [PARALLEL LANE]`,
    `${" ".repeat(indent)}│`,
  ];
}
