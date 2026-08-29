export interface SugiyamaNodeBadge {
  readonly implementerId?: string | undefined;
  readonly validatorId?: string | undefined;
  readonly coordinatorId?: string | undefined;
  readonly role: "implementer" | "validator" | "coordinator" | "observer" | "mind";
  readonly effortMinutes: number;
  readonly spanMinutes: number;
  readonly status: "PENDING" | "READY" | "LEASED" | "RUNNING" | "VALIDATING" | "COMPLETED" | "FAILED";
  readonly repairRound?: number | undefined;
}
export interface SugiyamaRankedNode {
  readonly id: string;
  readonly label: string;
  readonly rank: number;
  readonly order: number;
  readonly isDummy: boolean;
  readonly badges?: SugiyamaNodeBadge | undefined;
  readonly dependencies: readonly string[];
}
export interface SugiyamaEdge {
  readonly from: string;
  readonly to: string;
  readonly type?: string | undefined;
}
export interface SugiyamaLayoutConfig {
  readonly maxLaneWidth: number;
  readonly boxWidthChars: number;
  readonly boxHeightLines: number;
  readonly horizontalSpacing: number;
  readonly verticalSpacing: number;
}
export interface SugiyamaDagReport {
  readonly totalNodes: number;
  readonly totalLayers: number;
  readonly totalCrossings: number;
  readonly criticalPathSpan: number;
  readonly asciiDiagram: string;
  readonly layers: readonly (readonly SugiyamaRankedNode[])[];
}
export class AsciiCanvasMatrix {
  private readonly grid: string[][];
  public readonly width: number;
  public readonly height: number;
  constructor(width: number, height: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.grid = Array.from({ length: this.height }, () => Array(this.width).fill(" "));
  }
  public writeChar(x: number, y: number, char: string): void {
    if (x >= 0 && x < this.width && y >= 0 && y < this.height && this.grid[y]) {
      this.grid[y]![x] = char;
    }
  }
  public writeString(x: number, y: number, text: string): void {
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== undefined) this.writeChar(x + i, y, text[i]!);
    }
  }
  public drawBox(x: number, y: number, w: number, h: number, title: string, lines: readonly string[]): void {
    this.writeChar(x, y, "┌");
    for (let i = 1; i < w - 1; i++) this.writeChar(x + i, y, "─");
    this.writeChar(x + w - 1, y, "┐");
    this.writeChar(x, y + 1, "│");
    this.writeString(x + 2, y + 1, title.padEnd(w - 4).slice(0, w - 4));
    this.writeChar(x + w - 1, y + 1, "│");
    for (let row = 0; row < lines.length && row < h - 3; row++) {
      const lineY = y + 2 + row;
      this.writeChar(x, lineY, "│");
      this.writeString(x + 2, lineY, (lines[row] ?? "").padEnd(w - 4).slice(0, w - 4));
      this.writeChar(x + w - 1, lineY, "│");
    }
    const bottomY = y + h - 1;
    this.writeChar(x, bottomY, "└");
    for (let i = 1; i < w - 1; i++) this.writeChar(x + i, bottomY, "─");
    this.writeChar(x + w - 1, bottomY, "┘");
  }
  public drawHorizontalEdge(x1: number, x2: number, y: number): void {
    const startX = Math.min(x1, x2);
    const endX = Math.max(x1, x2);
    for (let x = startX; x <= endX; x++) {
      const curr = this.grid[y]?.[x] ?? " ";
      if (curr === "│") this.writeChar(x, y, "┼");
      else if (curr === " ") this.writeChar(x, y, "─");
    }
    this.writeChar(endX, y, "►");
  }
  public drawVerticalEdge(x: number, y1: number, y2: number): void {
    const startY = Math.min(y1, y2);
    const endY = Math.max(y1, y2);
    for (let y = startY; y <= endY; y++) {
      const curr = this.grid[y]?.[x] ?? " ";
      if (curr === "─") this.writeChar(x, y, "┼");
      else if (curr === " ") this.writeChar(x, y, "│");
    }
    this.writeChar(x, endY, "▼");
  }
  public renderToString(): string {
    return this.grid.map((row) => row.join("").trimEnd()).join("\n");
  }
}
export function computeBarycenter(
  nodeId: string,
  neighborPosMap: ReadonlyMap<string, number>,
  adjacency: ReadonlyMap<string, readonly string[]>,
  isPredecessor: boolean,
): number {
  const neighbors: string[] = [];
  if (isPredecessor) {
    for (const [parent, children] of adjacency) {
      if (children.includes(nodeId)) neighbors.push(parent);
    }
  } else {
    neighbors.push(...(adjacency.get(nodeId) ?? []));
  }
  if (neighbors.length === 0) return 0;
  return neighbors.reduce((acc, nId) => acc + (neighborPosMap.get(nId) ?? 0), 0) / neighbors.length;
}
export function minimizeCrossings(
  layers: readonly (readonly SugiyamaRankedNode[])[],
  adjacency: ReadonlyMap<string, readonly string[]>,
): SugiyamaRankedNode[][] {
  const currentLayers: SugiyamaRankedNode[][] = layers.map((layer) => [...layer]);
  for (let pass = 0; pass < 4; pass++) {
    if (pass % 2 === 0) {
      for (let k = 0; k < currentLayers.length - 1; k++) {
        const parentLayer = currentLayers[k];
        const nextLayer = currentLayers[k + 1];
        if (!parentLayer || !nextLayer) continue;
        const parentPosMap = new Map<string, number>(parentLayer.map((n, i) => [n.id, i]));
        nextLayer.sort((a, b) => {
          const baryA = computeBarycenter(a.id, parentPosMap, adjacency, true);
          const baryB = computeBarycenter(b.id, parentPosMap, adjacency, true);
          return baryA !== baryB ? baryA - baryB : a.order - b.order;
        });
      }
    } else {
      for (let k = currentLayers.length - 1; k > 0; k--) {
        const childLayer = currentLayers[k];
        const prevLayer = currentLayers[k - 1];
        if (!childLayer || !prevLayer) continue;
        const childPosMap = new Map<string, number>(childLayer.map((n, i) => [n.id, i]));
        prevLayer.sort((a, b) => {
          const baryA = computeBarycenter(a.id, childPosMap, adjacency, false);
          const baryB = computeBarycenter(b.id, childPosMap, adjacency, false);
          return baryA !== baryB ? baryA - baryB : a.order - b.order;
        });
      }
    }
  }
  return currentLayers;
}
export function assignSugiyamaLayers(
  nodes: readonly { readonly id: string; readonly dependencies: readonly string[] }[],
  maxWidth = 4,
): Map<string, number> {
  const ranks = new Map<string, number>();
  const visited = new Set<string>();
  function getRank(nodeId: string, path: Set<string>): number {
    if (ranks.has(nodeId)) return ranks.get(nodeId) ?? 0;
    if (path.has(nodeId)) return 0;
    path.add(nodeId);
    const node = nodes.find((n) => n.id === nodeId);
    if (!node || node.dependencies.length === 0) {
      ranks.set(nodeId, 0);
      return 0;
    }
    let maxPredRank = -1;
    for (const depId of node.dependencies) {
      const predRank = getRank(depId, new Set(path));
      if (predRank > maxPredRank) maxPredRank = predRank;
    }
    const calculated = maxPredRank + 1;
    ranks.set(nodeId, calculated);
    return calculated;
  }
  for (const node of nodes) {
    if (!visited.has(node.id)) {
      getRank(node.id, new Set());
      visited.add(node.id);
    }
  }
  const layerCounts = new Map<number, number>();
  const adjustedRanks = new Map<string, number>();
  const sortedNodes = [...nodes].sort((a, b) => (ranks.get(a.id) ?? 0) - (ranks.get(b.id) ?? 0));
  for (const node of sortedNodes) {
    let rank = ranks.get(node.id) ?? 0;
    while ((layerCounts.get(rank) ?? 0) >= maxWidth) rank++;
    layerCounts.set(rank, (layerCounts.get(rank) ?? 0) + 1);
    adjustedRanks.set(node.id, rank);
  }
  return adjustedRanks;
}
export function computeLayerCrossings(
  layer1: readonly SugiyamaRankedNode[],
  layer2: readonly SugiyamaRankedNode[],
  edges: readonly SugiyamaEdge[],
): number {
  const pos1 = new Map<string, number>(layer1.map((n, idx) => [n.id, idx]));
  const pos2 = new Map<string, number>(layer2.map((n, idx) => [n.id, idx]));
  const activeEdges = edges.filter((e) => pos1.has(e.from) && pos2.has(e.to));
  let crossings = 0;
  for (let i = 0; i < activeEdges.length; i++) {
    for (let j = i + 1; j < activeEdges.length; j++) {
      const e1 = activeEdges[i];
      const e2 = activeEdges[j];
      if (!e1 || !e2) continue;
      const u1 = pos1.get(e1.from) ?? 0;
      const v1 = pos2.get(e1.to) ?? 0;
      const u2 = pos1.get(e2.from) ?? 0;
      const v2 = pos2.get(e2.to) ?? 0;
      if ((u1 < u2 && v1 > v2) || (u1 > u2 && v1 < v2)) crossings++;
    }
  }
  return crossings;
}
export function layoutSugiyamaDag(
  nodes: readonly SugiyamaRankedNode[],
  edges: readonly SugiyamaEdge[],
  config: Partial<SugiyamaLayoutConfig> = {},
): SugiyamaDagReport {
  const maxLaneWidth = config.maxLaneWidth ?? 4;
  const boxWidth = config.boxWidthChars ?? 28;
  const boxHeight = config.boxHeightLines ?? 5;
  const hSpacing = config.horizontalSpacing ?? 4;
  const vSpacing = config.verticalSpacing ?? 2;
  if (nodes.length === 0) return { totalNodes: 0, totalLayers: 0, totalCrossings: 0, criticalPathSpan: 0, asciiDiagram: "(Empty DAG)", layers: [] };
  const rankMap = assignSugiyamaLayers(nodes, maxLaneWidth);
  const maxRank = Math.max(0, ...[...rankMap.values()]);
  const rawLayers: SugiyamaRankedNode[][] = [];
  for (let r = 0; r <= maxRank; r++) {
    const inRank = nodes.filter((n) => (rankMap.get(n.id) ?? 0) === r).map((n, idx) => ({ ...n, rank: r, order: idx }));
    if (inRank.length > 0) rawLayers.push(inRank);
  }
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) adjacency.set(node.id, []);
  for (const edge of edges) {
    const list = adjacency.get(edge.from);
    if (list) list.push(edge.to);
    else adjacency.set(edge.from, [edge.to]);
  }
  const optimizedLayers = minimizeCrossings(rawLayers, adjacency);
  let totalCrossings = 0;
  for (let k = 0; k < optimizedLayers.length - 1; k++) {
    const l1 = optimizedLayers[k];
    const l2 = optimizedLayers[k + 1];
    if (l1 && l2) totalCrossings += computeLayerCrossings(l1, l2, edges);
  }
  const layerCount = optimizedLayers.length;
  const maxNodesInLayer = Math.max(1, ...optimizedLayers.map((l) => l.length));
  const canvas = new AsciiCanvasMatrix(layerCount * (boxWidth + hSpacing), maxNodesInLayer * (boxHeight + vSpacing) + 2);
  const nodePositions = new Map<string, { x: number; y: number }>();
  for (let lIdx = 0; lIdx < optimizedLayers.length; lIdx++) {
    const layer = optimizedLayers[lIdx];
    if (!layer) continue;
    const x = lIdx * (boxWidth + hSpacing);
    for (let nIdx = 0; nIdx < layer.length; nIdx++) {
      const node = layer[nIdx];
      if (!node) continue;
      const y = nIdx * (boxHeight + vSpacing);
      nodePositions.set(node.id, { x, y });
      const statusBadge = node.badges?.status ?? "READY";
      const roleBadge = node.badges ? `[${node.badges.role.toUpperCase()}]` : "";
      const implBadge = node.badges?.implementerId ? `I:${node.badges.implementerId}` : "";
      const lines = [`${roleBadge} [${statusBadge}]`.trim(), implBadge, `Deps: ${node.dependencies.join(",") || "none"}`].filter((l) => l.length > 0);
      canvas.drawBox(x, y, boxWidth, boxHeight, node.id, lines);
    }
  }
  for (const edge of edges) {
    const fromPos = nodePositions.get(edge.from);
    const toPos = nodePositions.get(edge.to);
    if (fromPos && toPos) {
      if (fromPos.x < toPos.x) canvas.drawHorizontalEdge(fromPos.x + boxWidth, toPos.x, fromPos.y + 2);
      else if (fromPos.y !== toPos.y) canvas.drawVerticalEdge(fromPos.x + Math.floor(boxWidth / 2), fromPos.y + boxHeight, toPos.y);
    }
  }
  return {
    totalNodes: nodes.length,
    totalLayers: optimizedLayers.length,
    totalCrossings,
    criticalPathSpan: nodes.reduce((acc, node) => acc + (node.badges?.spanMinutes ?? 1), 0),
    asciiDiagram: canvas.renderToString(),
    layers: optimizedLayers,
  };
}
