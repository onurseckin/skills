import type {
  OrthogonalRouteSegment,
  SugiyamaEdge,
  SugiyamaLayer,
  SugiyamaRankedNode,
} from "./types.ts";

export type { OrthogonalRouteSegment };

const UP = 1;
const DOWN = 2;
const LEFT = 4;
const RIGHT = 8;

const BOX_GLYPHS: Readonly<Record<number, string>> = {
  0: " ",
  1: "│",
  2: "│",
  3: "│",
  4: "─",
  5: "┘",
  6: "┐",
  7: "┤",
  8: "─",
  9: "└",
  10: "┌",
  11: "├",
  12: "─",
  13: "┴",
  14: "┬",
  15: "┼",
};

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
      fromWave: fromNode.wave ?? fromNode.rank + 1,
      toWave: toNode.wave ?? toNode.rank + 1,
      fromLane: fromNode.lane ?? fromNode.order + 1,
      toLane: toNode.lane ?? toNode.order + 1,
    });
  }

  return segments;
}

export function insertVirtualDummyNodes(
  layers: readonly SugiyamaLayer[],
  edges: readonly SugiyamaEdge[],
): {
  readonly layers: SugiyamaLayer[];
  readonly edges: SugiyamaEdge[];
  readonly dummyNodes: SugiyamaRankedNode[];
} {
  const nodeRankMap = new Map<string, number>();
  for (const layer of layers) {
    for (const node of layer.nodes) {
      nodeRankMap.set(node.id, layer.rank);
    }
  }

  const newLayers = layers.map((l) => ({
    rank: l.rank,
    nodes: [...l.nodes],
  }));
  const layerByRank = new Map<number, SugiyamaRankedNode[]>();
  for (const l of newLayers) {
    layerByRank.set(l.rank, l.nodes);
  }

  const normalizedEdges: SugiyamaEdge[] = [];
  const dummyNodes: SugiyamaRankedNode[] = [];

  for (const edge of edges) {
    const srcRank = nodeRankMap.get(edge.from);
    const tgtRank = nodeRankMap.get(edge.to);

    if (srcRank === undefined || tgtRank === undefined || tgtRank - srcRank <= 1) {
      normalizedEdges.push(edge);
      continue;
    }

    let prevNodeId = edge.from;
    for (let r = srcRank + 1; r < tgtRank; r++) {
      const dummyId = `__dummy__${edge.from}__${edge.to}__r${r}`;
      const existingInRank = layerByRank.get(r) ?? [];
      const dummyOrder = existingInRank.length;

      const dummyNode: SugiyamaRankedNode = {
        id: dummyId,
        label: `(transit: ${edge.from} ➔ ${edge.to})`,
        status: "pending",
        dependencies: [prevNodeId],
        isDummy: true,
        origSource: edge.from,
        origTarget: edge.to,
        rank: r,
        order: dummyOrder,
        wave: r + 1,
        lane: dummyOrder + 1,
        coordinates: { wave: r + 1, lane: dummyOrder + 1, rank: r, order: dummyOrder },
      };

      existingInRank.push(dummyNode);
      dummyNodes.push(dummyNode);
      nodeRankMap.set(dummyId, r);

      normalizedEdges.push({
        from: prevNodeId,
        to: dummyId,
        type: "virtual",
        reason: edge.reason,
      });

      prevNodeId = dummyId;
    }

    normalizedEdges.push({
      from: prevNodeId,
      to: edge.to,
      type: "virtual",
      reason: edge.reason,
    });
  }

  return {
    layers: newLayers,
    edges: normalizedEdges,
    dummyNodes,
  };
}

export function renderOrthogonalConnectors(
  fromLayer: SugiyamaLayer,
  toLayer: SugiyamaLayer,
  edges: readonly SugiyamaEdge[],
  indent = 30,
): string[] {
  const fromNodes = fromLayer.nodes;
  const toNodes = toLayer.nodes;

  if (fromNodes.length === 0 || toNodes.length === 0) {
    return [`${" ".repeat(indent)}│`, `${" ".repeat(indent)}▼`];
  }

  const fromIds = new Set(fromNodes.map((n) => n.id));
  const toIds = new Set(toNodes.map((n) => n.id));
  const relevantEdges = edges.filter((e) => fromIds.has(e.from) && toIds.has(e.to));

  if (relevantEdges.length === 0) {
    return [`${" ".repeat(indent)}│`, `${" ".repeat(indent)}▼`];
  }

  if (fromNodes.length === 1 && toNodes.length === 1) {
    return [`${" ".repeat(indent)}│`, `${" ".repeat(indent)}▼`];
  }

  const numFrom = fromNodes.length;
  const numTo = toNodes.length;
  const step = 8;

  const fromColMap = new Map<string, number>();
  const toColMap = new Map<string, number>();

  if (numFrom === 1 && numTo > 1) {
    const startCol = Math.max(0, indent - Math.floor(((numTo - 1) * step) / 2));
    for (let j = 0; j < numTo; j++) {
      const node = toNodes[j];
      if (node) toColMap.set(node.id, startCol + j * step);
    }
    const firstTargetCol = toColMap.get(toNodes[0]?.id ?? "") ?? startCol;
    const lastTargetCol = toColMap.get(toNodes[numTo - 1]?.id ?? "") ?? startCol;
    const centerCol = Math.round((firstTargetCol + lastTargetCol) / 2);
    const sourceNode = fromNodes[0];
    if (sourceNode) fromColMap.set(sourceNode.id, centerCol);
  } else if (numFrom > 1 && numTo === 1) {
    const startCol = Math.max(0, indent - Math.floor(((numFrom - 1) * step) / 2));
    for (let i = 0; i < numFrom; i++) {
      const node = fromNodes[i];
      if (node) fromColMap.set(node.id, startCol + i * step);
    }
    const firstSourceCol = fromColMap.get(fromNodes[0]?.id ?? "") ?? startCol;
    const lastSourceCol = fromColMap.get(fromNodes[numFrom - 1]?.id ?? "") ?? startCol;
    const centerCol = Math.round((firstSourceCol + lastSourceCol) / 2);
    const targetNode = toNodes[0];
    if (targetNode) toColMap.set(targetNode.id, centerCol);
  } else {
    const maxCount = Math.max(numFrom, numTo);
    const startCol = Math.max(0, indent - Math.floor(((maxCount - 1) * step) / 2));
    for (let i = 0; i < numFrom; i++) {
      const node = fromNodes[i];
      if (node) fromColMap.set(node.id, startCol + i * step);
    }
    for (let j = 0; j < numTo; j++) {
      const node = toNodes[j];
      if (node) toColMap.set(node.id, startCol + j * step);
    }
  }

  const allCols = [...fromColMap.values(), ...toColMap.values(), indent];
  const maxCol = Math.max(...allCols) + 2;

  const mask = new Uint8Array(maxCol + 1);
  const hasTopDrop = new Uint8Array(maxCol + 1);
  const hasBottomDrop = new Uint8Array(maxCol + 1);
  let hasCross = false;

  for (const edge of relevantEdges) {
    const xs = fromColMap.get(edge.from);
    const xt = toColMap.get(edge.to);
    if (xs === undefined || xt === undefined) continue;

    hasTopDrop[xs] = 1;
    hasBottomDrop[xt] = 1;

    if (xs === xt) {
      mask[xs] = (mask[xs] ?? 0) | (UP | DOWN);
    } else if (xs < xt) {
      hasCross = true;
      mask[xs] = (mask[xs] ?? 0) | (UP | RIGHT);
      for (let c = xs + 1; c < xt; c++) {
        mask[c] = (mask[c] ?? 0) | (LEFT | RIGHT);
      }
      mask[xt] = (mask[xt] ?? 0) | (DOWN | LEFT);
    } else {
      hasCross = true;
      mask[xs] = (mask[xs] ?? 0) | (UP | LEFT);
      for (let c = xt + 1; c < xs; c++) {
        mask[c] = (mask[c] ?? 0) | (LEFT | RIGHT);
      }
      mask[xt] = (mask[xt] ?? 0) | (DOWN | RIGHT);
    }
  }

  let channelType = "PARALLEL CHANNEL";
  if (numFrom === 1 && numTo > 1) {
    channelType = "FAN-OUT BUS";
  } else if (numFrom > 1 && numTo === 1) {
    channelType = "FAN-IN BUS";
  } else if (hasCross) {
    channelType = "CROSS-LANE JUNCTION";
  }

  const row1: string[] = Array.from({ length: maxCol + 1 }, () => " ");
  const row2: string[] = Array.from({ length: maxCol + 1 }, () => " ");
  const row3: string[] = Array.from({ length: maxCol + 1 }, () => " ");

  for (let c = 0; c <= maxCol; c++) {
    if (hasTopDrop[c]) {
      row1[c] = "│";
    }
    const m = mask[c] ?? 0;
    if (m > 0) {
      row2[c] = BOX_GLYPHS[m] ?? "─";
    }
    if (hasBottomDrop[c]) {
      row3[c] = "▼";
    }
  }

  const line1 = row1.join("").trimEnd();
  const line2 = `${row2.join("").trimEnd()} ──▶ [W${toLayer.rank + 1} ${channelType}]`;
  const line3 = row3.join("").trimEnd();

  return [line1, line2, line3];
}

export function renderInterWaveConnector(
  fromLayer: SugiyamaLayer,
  toLayer: SugiyamaLayer,
  edges: readonly SugiyamaEdge[],
  indent = 30,
): string[] {
  return renderOrthogonalConnectors(fromLayer, toLayer, edges, indent);
}

export function renderLaneSeparator(indent = 30): string[] {
  const padding = " ".repeat(Math.max(0, indent - 6));
  return [
    `${" ".repeat(indent)}│`,
    `${padding}──┬── ──▶ [PARALLEL LANE]`,
    `${" ".repeat(indent)}│`,
  ];
}
