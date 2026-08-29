import { computeOptimizedLayout } from "./layout-optimizer.ts";
import { getStatusStyle, resolveExporterTheme } from "./theme.ts";
import type {
  DagExportOptions,
  DagExportResult,
  DagLayoutCluster,
  DagLayoutEdgePoint,
  DagLayoutNodePoint,
  DagOptimizedLayout,
  SugiyamaEdge,
  SugiyamaNode,
} from "./types.ts";

function escapeXml(unsafe: string): string {
  return unsafe
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function renderClusterSvg(cluster: DagLayoutCluster, strokeColor: string): string {
  const label = escapeXml(cluster.label);
  return `  <g class="cluster" id="${escapeXml(cluster.id)}">
    <rect x="${cluster.x}" y="${cluster.y}" width="${cluster.width}" height="${cluster.height}" rx="12" ry="12" fill="none" stroke="${strokeColor}" stroke-dasharray="4 4" stroke-width="1.5" opacity="0.6"/>
    <text x="${cluster.x + 12}" y="${cluster.y + 16}" fill="${strokeColor}" font-size="11" font-weight="600" font-family="ui-monospace, monospace" opacity="0.8">${label}</text>
  </g>`;
}

function renderEdgeSvg(edge: DagLayoutEdgePoint, strokeColor: string, isHorizontal: boolean): string {
  const { fromX, fromY, toX, toY } = edge;
  let pathData = "";

  if (edge.waypoints.length === 2) {
    const p1 = edge.waypoints[0]!;
    const p2 = edge.waypoints[1]!;
    pathData = `M ${fromX} ${fromY} L ${p1.x} ${p1.y} L ${p2.x} ${p2.y} L ${toX} ${toY}`;
  } else if (isHorizontal) {
    const dx = Math.abs(toX - fromX) * 0.5;
    pathData = `M ${fromX} ${fromY} C ${fromX + dx} ${fromY}, ${toX - dx} ${toY}, ${toX} ${toY}`;
  } else {
    const dy = Math.abs(toY - fromY) * 0.5;
    pathData = `M ${fromX} ${fromY} C ${fromX} ${fromY + dy}, ${toX} ${toY - dy}, ${toX} ${toY}`;
  }

  const reasonText = edge.reason ? `<title>${escapeXml(edge.reason)}</title>` : "";
  return `  <path class="edge" d="${pathData}" fill="none" stroke="${strokeColor}" stroke-width="2" marker-end="url(#arrowhead)" opacity="0.85">${reasonText}</path>`;
}

function renderNodeSvg(
  node: DagLayoutNodePoint,
  themeColors: ReturnType<typeof getStatusStyle>,
  textColor: string,
  secColor: string,
): string {
  const { x, y, width, height, label, id, status, wave, lane } = node;
  const safeId = escapeXml(id);
  const safeLabel = escapeXml(label.length > 24 ? `${label.slice(0, 21)}...` : label);
  const safeStatus = escapeXml(status.toUpperCase());
  const coords = `W${wave}:L${lane}`;

  let badgeLine = "";
  if (node.assignedAgent) {
    badgeLine = `Agent: ${node.assignedAgent}`;
  } else if (node.gate) {
    badgeLine = `Gate: ${node.gate}`;
  }

  const subLine = badgeLine
    ? `<text x="${x + 12}" y="${y + 68}" fill="${secColor}" font-size="10" font-family="ui-monospace, monospace">${escapeXml(badgeLine)}</text>`
    : "";

  return `  <g class="node" id="node-${safeId}">
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="8" ry="8" fill="${themeColors.fill}" stroke="${themeColors.stroke}" stroke-width="2"/>
    <rect x="${x + width - 70}" y="${y + 10}" width="60" height="18" rx="4" ry="4" fill="${themeColors.stroke}" opacity="0.2"/>
    <text x="${x + width - 40}" y="${y + 23}" fill="${themeColors.text}" font-size="9" font-weight="700" text-anchor="middle" font-family="ui-monospace, monospace">${safeStatus}</text>
    <text x="${x + 12}" y="${y + 26}" fill="${textColor}" font-size="12" font-weight="700" font-family="ui-monospace, monospace">${safeId}</text>
    <text x="${x + 12}" y="${y + 46}" fill="${secColor}" font-size="11" font-family="ui-monospace, monospace">${safeLabel}</text>
    <text x="${x + width - 12}" y="${y + height - 10}" fill="${secColor}" font-size="9" text-anchor="end" font-family="ui-monospace, monospace">${coords}</text>
    ${subLine}
  </g>`;
}

export function exportDagToSvg(
  nodesOrLayout: readonly SugiyamaNode[] | DagOptimizedLayout,
  edgesOrOptions?: readonly SugiyamaEdge[] | DagExportOptions,
  optionsOrUndefined?: DagExportOptions,
): DagExportResult {
  let layout: DagOptimizedLayout;
  let options: DagExportOptions;

  if ("nodes" in nodesOrLayout && "edges" in nodesOrLayout) {
    layout = nodesOrLayout;
    options = (edgesOrOptions as DagExportOptions) ?? {};
  } else {
    const nodes = nodesOrLayout as readonly SugiyamaNode[];
    const edges = (edgesOrOptions as readonly SugiyamaEdge[]) ?? [];
    options = optionsOrUndefined ?? {};
    layout = computeOptimizedLayout(nodes, edges, options);
  }

  const theme = resolveExporterTheme(options.theme, options.customTheme);
  const isHorizontal = options.direction === "LR";
  const title = layout.title || options.title;

  const headerHeight = title ? 40 : 0;
  const totalHeight = layout.height + headerHeight;
  const totalWidth = layout.width;

  const titleSvg = title
    ? `  <text x="${totalWidth / 2}" y="28" fill="${theme.textPrimary}" font-size="16" font-weight="700" text-anchor="middle" font-family="${theme.fontFamily}">${escapeXml(title)}</text>`
    : "";

  const clustersSvg =
    options.showClusters !== false
      ? layout.clusters.map((c) => renderClusterSvg(c, theme.border)).join("\n")
      : "";

  const edgesSvg = layout.edges
    .map((e) => renderEdgeSvg(e, theme.edgeColor, isHorizontal))
    .join("\n");

  const nodesSvg = layout.nodes
    .map((n) => {
      const colors = getStatusStyle(n.status, theme);
      return renderNodeSvg(n, colors, theme.textPrimary, theme.textSecondary);
    })
    .join("\n");

  const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="${totalWidth}" height="${totalHeight}">
  <defs>
    <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <polygon points="0 0, 8 3, 0 6" fill="${theme.edgeColor}"/>
    </marker>
    <marker id="arrowhead-highlight" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <polygon points="0 0, 8 3, 0 6" fill="${theme.edgeHighlight}"/>
    </marker>
  </defs>
  <rect width="100%" height="100%" fill="${theme.background}"/>
${titleSvg}
  <g transform="translate(0, ${headerHeight})">
${clustersSvg}
${edgesSvg}
${nodesSvg}
  </g>
</svg>`;

  return {
    format: "svg",
    content: svgContent,
    mimeType: "image/svg+xml",
    width: totalWidth,
    height: totalHeight,
    nodeCount: layout.nodes.length,
    edgeCount: layout.edges.length,
    layerCount: layout.metrics.totalWaves,
  };
}
