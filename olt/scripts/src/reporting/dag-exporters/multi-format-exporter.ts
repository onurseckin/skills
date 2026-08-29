import { exportDagToAscii } from "./ascii-exporter.ts";
import { exportDagToDot } from "./dot-exporter.ts";
import { computeOptimizedLayout } from "./layout-optimizer.ts";
import { exportDagToMermaid } from "./mermaid-exporter.ts";
import { exportDagToSvg } from "./svg-exporter.ts";
import type {
  DagExportOptions,
  DagExportResult,
  DagOptimizedLayout,
  MultiFormatExportResult,
  SugiyamaEdge,
  SugiyamaNode,
} from "./types.ts";

export function exportDagToJson(
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

  const jsonPayload = {
    title: layout.title || options.title,
    width: layout.width,
    height: layout.height,
    metrics: layout.metrics,
    clusters: layout.clusters,
    nodes: layout.nodes,
    edges: layout.edges,
  };

  return {
    format: "json",
    content: JSON.stringify(jsonPayload, null, 2),
    mimeType: "application/json",
    width: layout.width,
    height: layout.height,
    nodeCount: layout.nodes.length,
    edgeCount: layout.edges.length,
    layerCount: layout.metrics.totalWaves,
  };
}

export function exportVisualDag(
  nodesOrLayout: readonly SugiyamaNode[] | DagOptimizedLayout,
  edgesOrOptions?: readonly SugiyamaEdge[] | DagExportOptions,
  optionsOrUndefined?: DagExportOptions,
): DagExportResult {
  let options: DagExportOptions;

  if ("nodes" in nodesOrLayout && "edges" in nodesOrLayout) {
    options = (edgesOrOptions as DagExportOptions) ?? {};
  } else {
    options = optionsOrUndefined ?? {};
  }

  const format = options.format ?? "svg";

  switch (format) {
    case "svg":
      return exportDagToSvg(nodesOrLayout, edgesOrOptions, optionsOrUndefined);
    case "mermaid":
      return exportDagToMermaid(nodesOrLayout, edgesOrOptions, optionsOrUndefined);
    case "ascii":
      return exportDagToAscii(nodesOrLayout, edgesOrOptions, optionsOrUndefined);
    case "dot":
      return exportDagToDot(nodesOrLayout, edgesOrOptions, optionsOrUndefined);
    case "json":
      return exportDagToJson(nodesOrLayout, edgesOrOptions, optionsOrUndefined);
    default:
      return exportDagToSvg(nodesOrLayout, edgesOrOptions, optionsOrUndefined);
  }
}

export function exportAllVisualDagFormats(
  nodesOrLayout: readonly SugiyamaNode[] | DagOptimizedLayout,
  edgesOrOptions?: readonly SugiyamaEdge[] | DagExportOptions,
  optionsOrUndefined?: DagExportOptions,
): MultiFormatExportResult {
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

  return {
    svg: exportDagToSvg(layout, options),
    mermaid: exportDagToMermaid(layout, options),
    ascii: exportDagToAscii(layout, options),
    dot: exportDagToDot(layout, options),
    json: exportDagToJson(layout, options),
  };
}
