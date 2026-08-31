import { minimizeCrossingsBarycenter } from "../sugiyama-dag/crossing.ts";
import { assignSugiyamaRanks } from "../sugiyama-dag/ranking.ts";
import { insertVirtualDummyNodes } from "../sugiyama-dag/routing.ts";
import { extractFeedbackArcSet, reverseCycleEdges } from "../sugiyama-dag/tarjan.ts";
import type {
  SugiyamaEdge,
  SugiyamaLayer,
  SugiyamaNode,
  SugiyamaWaveMetrics,
} from "../sugiyama-dag/types.ts";
import type {
  DagExportOptions,
  DagLayoutCluster,
  DagLayoutEdgePoint,
  DagLayoutNodePoint,
  DagOptimizedLayout,
} from "./types.ts";
import { type DagDimensions, resolveDimensions } from "./theme.ts";

export { resolveDimensions, type DagDimensions as LayoutDimensions };

export function computeOptimizedLayout(
  nodes: readonly SugiyamaNode[],
  edges: readonly SugiyamaEdge[],
  options: DagExportOptions = {},
): DagOptimizedLayout {
  if (nodes.length === 0) {
    const emptyMetrics: SugiyamaWaveMetrics = {
      totalWaves: 0,
      maxParallelLanes: 0,
      criticalPathLength: 0,
      averageWaveConcurrency: 0,
      serialBottlenecks: 0,
      parallelEligibleChains: 0,
      totalWork: 0,
      span: 0,
      parallelismFactor: 0,
      optimalConcurrency: 0,
    };
    return {
      width: 400,
      height: 200,
      nodes: [],
      edges: [],
      clusters: [],
      metrics: emptyMetrics,
      title: options.title,
    };
  }

  const { feedbackArcs, acyclicEdges } = extractFeedbackArcSet(nodes, edges);
  const normalizedEdges = reverseCycleEdges(edges, feedbackArcs);
  const rankMap = assignSugiyamaRanks(nodes, acyclicEdges, []);
  const maxRank = Math.max(0, ...rankMap.values());

  const initialLayers: SugiyamaLayer[] = [];
  for (let r = 0; r <= maxRank; r++) {
    const nodesInRank = nodes
      .filter((n) => (rankMap.get(n.id) ?? 0) === r)
      .map((n, order) => {
        const wave = n.wave ?? r + 1;
        const lane = n.lane ?? order + 1;
        return {
          ...n,
          rank: r,
          order,
          wave,
          lane,
          coordinates: n.coordinates ?? { wave, lane, rank: r, order },
        };
      });
    if (nodesInRank.length > 0) {
      initialLayers.push({ rank: r, nodes: nodesInRank });
    }
  }

  const { layers: layeredWithDummies, edges: dummyEdges } = insertVirtualDummyNodes(
    initialLayers,
    normalizedEdges,
  );
  const optimizedLayers = minimizeCrossingsBarycenter(layeredWithDummies, dummyEdges, 4);
  const dims = resolveDimensions(options);
  const isHorizontal = options.direction === "LR";

  let maxLayerNodeCount = 0;
  for (const layer of optimizedLayers) {
    if (layer.nodes.length > maxLayerNodeCount) {
      maxLayerNodeCount = layer.nodes.length;
    }
  }

  const totalBreadth =
    maxLayerNodeCount * dims.nodeWidth + Math.max(0, maxLayerNodeCount - 1) * dims.nodeSpacing;

  const layoutNodes: DagLayoutNodePoint[] = [];
  const nodePositionMap = new Map<string, DagLayoutNodePoint>();
  const clusters: DagLayoutCluster[] = [];

  for (let layerIdx = 0; layerIdx < optimizedLayers.length; layerIdx++) {
    const layer = optimizedLayers[layerIdx]!;
    const layerNodeCount = layer.nodes.length;
    const currentLayerBreadth =
      layerNodeCount * dims.nodeWidth + Math.max(0, layerNodeCount - 1) * dims.nodeSpacing;
    const startBreadthOffset = (totalBreadth - currentLayerBreadth) / 2;

    const layerClusterNodeIds: string[] = [];
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (let nodeIdx = 0; nodeIdx < layer.nodes.length; nodeIdx++) {
      const node = layer.nodes[nodeIdx]!;
      const breadthPos =
        dims.paddingX + startBreadthOffset + nodeIdx * (dims.nodeWidth + dims.nodeSpacing);
      const depthPos = dims.paddingY + layerIdx * (dims.nodeHeight + dims.layerSpacing);

      const x = isHorizontal ? depthPos : breadthPos;
      const y = isHorizontal ? breadthPos : depthPos;
      const width = isHorizontal ? dims.nodeHeight * 2 : dims.nodeWidth;
      const height = isHorizontal ? dims.nodeHeight : dims.nodeHeight;

      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x + width > maxX) maxX = x + width;
      if (y + height > maxY) maxY = y + height;

      const badges: string[] = [];
      if (node.assignedAgent) badges.push(`Agent: ${node.assignedAgent}`);
      if (node.validatorAgent) badges.push(`Val: ${node.validatorAgent}`);
      if (node.gate) badges.push(`Gate: ${node.gate}`);
      if (typeof node.effort === "number") badges.push(`Effort: ${node.effort}`);

      const nodePoint: DagLayoutNodePoint = {
        id: node.id,
        label: node.label || node.id,
        status: node.status || "ready",
        x,
        y,
        width,
        height,
        rank: layer.rank,
        order: nodeIdx,
        wave: node.wave ?? layer.rank + 1,
        lane: nodeIdx + 1,
        role: node.assignedRole ?? undefined,
        assignedAgent: node.assignedAgent,
        validatorAgent: node.validatorAgent,
        gate: node.gate,
        effort: node.effort,
        badges,
      };

      layoutNodes.push(nodePoint);
      nodePositionMap.set(node.id, nodePoint);
      layerClusterNodeIds.push(node.id);
    }

    if (layerClusterNodeIds.length > 0) {
      clusters.push({
        id: `wave-${layer.rank + 1}`,
        label: `Wave ${layer.rank + 1}`,
        rank: layer.rank,
        x: minX - 16,
        y: minY - 16,
        width: maxX - minX + 32,
        height: maxY - minY + 32,
        nodeIds: layerClusterNodeIds,
      });
    }
  }

  const layoutEdges: DagLayoutEdgePoint[] = [];
  for (const edge of edges) {
    const src = nodePositionMap.get(edge.from);
    const tgt = nodePositionMap.get(edge.to);
    if (!src || !tgt) continue;

    const fromX = isHorizontal ? src.x + src.width : src.x + src.width / 2;
    const fromY = isHorizontal ? src.y + src.height / 2 : src.y + src.height;
    const toX = isHorizontal ? tgt.x : tgt.x + tgt.width / 2;
    const toY = isHorizontal ? tgt.y + tgt.height / 2 : tgt.y;

    const midX = (fromX + toX) / 2;
    const midY = (fromY + toY) / 2;

    const waypoints = isHorizontal
      ? [
          { x: midX, y: fromY },
          { x: midX, y: toY },
        ]
      : [
          { x: fromX, y: midY },
          { x: toX, y: midY },
        ];

    layoutEdges.push({
      from: edge.from,
      to: edge.to,
      fromX,
      fromY,
      toX,
      toY,
      waypoints,
      type: edge.type,
      reason: edge.reason,
    });
  }

  let canvasWidth = dims.paddingX * 2 + totalBreadth;
  let canvasHeight =
    dims.paddingY * 2 +
    optimizedLayers.length * dims.nodeHeight +
    Math.max(0, optimizedLayers.length - 1) * dims.layerSpacing;

  if (isHorizontal) {
    const temp = canvasWidth;
    canvasWidth = canvasHeight;
    canvasHeight = temp;
  }

  const totalWork = nodes.reduce((acc, n) => acc + (n.effort ?? 1), 0);
  const span = optimizedLayers.length;
  const parallelismFactor = span > 0 ? Number((totalWork / span).toFixed(2)) : 1;

  const metrics: SugiyamaWaveMetrics = {
    totalWaves: optimizedLayers.length,
    maxParallelLanes: maxLayerNodeCount,
    criticalPathLength: optimizedLayers.length,
    averageWaveConcurrency:
      optimizedLayers.length > 0 ? Number((nodes.length / optimizedLayers.length).toFixed(2)) : 0,
    serialBottlenecks: optimizedLayers.filter((l) => l.nodes.length === 1).length,
    parallelEligibleChains: maxLayerNodeCount > 1 ? maxLayerNodeCount : 0,
    totalWork,
    span,
    parallelismFactor,
    optimalConcurrency: Math.max(1, Math.ceil(totalWork / (span || 1))),
  };

  return {
    width: Math.max(400, canvasWidth),
    height: Math.max(200, canvasHeight),
    nodes: layoutNodes,
    edges: layoutEdges,
    clusters,
    metrics,
    title: options.title,
  };
}
