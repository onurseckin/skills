import { computeOptimizedLayout } from "./layout-optimizer.ts";
import { getStatusStyle, resolveExporterTheme } from "./theme.ts";
import type {
  DagExportOptions,
  DagExportResult,
  DagLayoutNodePoint,
  DagOptimizedLayout,
  SugiyamaEdge,
  SugiyamaNode,
} from "./types.ts";

function sanitizeDotId(id: string): string {
  return `"${id.replaceAll('"', '\\"')}"`;
}

function escapeDotHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderDotNodeHtml(
  node: DagLayoutNodePoint,
  statusColors: ReturnType<typeof getStatusStyle>,
  fontFamily: string,
): string {
  const safeId = sanitizeDotId(node.id);
  const safeLabel = escapeDotHtml(node.label);
  const safeStatus = escapeDotHtml(node.status.toUpperCase());
  const coords = `W${node.wave}:L${node.lane}`;

  let extraRow = "";
  if (node.assignedAgent) {
    extraRow = `<tr><td align="left"><font point-size="9" color="#8b949e">Agent: ${escapeDotHtml(node.assignedAgent)}</font></td></tr>`;
  } else if (node.gate) {
    extraRow = `<tr><td align="left"><font point-size="9" color="#8b949e">Gate: ${escapeDotHtml(node.gate)}</font></td></tr>`;
  }

  const labelHtml = `<<table border="0" cellborder="0" cellpadding="4" cellspacing="0" bgcolor="${statusColors.fill}" style="rounded">
    <tr><td align="left"><b><font point-size="11" color="${statusColors.text}">${escapeDotHtml(node.id)}</font></b></td><td align="right"><font point-size="9" color="${statusColors.stroke}"><b>${safeStatus}</b></font></td></tr>
    <tr><td colspan="2" align="left"><font point-size="10" color="#c9d1d9">${safeLabel}</font></td></tr>
    <tr><td align="left"><font point-size="8" color="#8b949e">${coords}</font></td></tr>
    ${extraRow}
  </table>>`;

  return `    ${safeId} [shape=box, style="filled,rounded", color="${statusColors.stroke}", penwidth=2, label=${labelHtml}, fontname="${fontFamily}"];`;
}

export function exportDagToDot(
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
  const direction = options.direction ?? "TB";
  const rankdir = direction === "LR" ? "LR" : "TB";

  const lines: string[] = [];
  lines.push("digraph VisualDag {");
  lines.push(
    `  graph [rankdir="${rankdir}", bgcolor="${theme.background}", fontname="${theme.fontFamily}", pad="0.5", nodesep="0.4", ranksep="0.6"];`,
  );
  lines.push(`  node [fontname="${theme.fontFamily}"];`);
  lines.push(
    `  edge [fontname="${theme.fontFamily}", color="${theme.edgeColor}", penwidth="1.5", arrowsize="0.8"];`,
  );

  if (options.title || layout.title) {
    const title = escapeDotHtml(options.title || layout.title || "");
    lines.push(`  labelloc="t";`);
    lines.push(
      `  label=<<font point-size="14" color="${theme.textPrimary}"><b>${title}</b></font><br/><br/>>;`,
    );
  }

  const showClusters = options.showClusters !== false;
  const nodesByWave = new Map<number, DagLayoutNodePoint[]>();

  for (const node of layout.nodes) {
    const wave = node.wave;
    const group = nodesByWave.get(wave) ?? [];
    group.push(node);
    nodesByWave.set(wave, group);
  }

  const sortedWaves = [...nodesByWave.keys()].sort((a, b) => a - b);

  if (showClusters && sortedWaves.length > 0) {
    for (const wave of sortedWaves) {
      const waveNodes = nodesByWave.get(wave) ?? [];
      lines.push(`  subgraph cluster_wave_${wave} {`);
      lines.push(
        `    label=<<font point-size="10" color="${theme.textSecondary}">Wave ${wave}</font>>;`,
      );
      lines.push(`    style="dashed,rounded";`);
      lines.push(`    color="${theme.border}";`);
      for (const node of waveNodes) {
        const colors = getStatusStyle(node.status, theme);
        lines.push(renderDotNodeHtml(node, colors, theme.fontFamily));
      }
      lines.push("  }");
    }
  } else {
    for (const node of layout.nodes) {
      const colors = getStatusStyle(node.status, theme);
      lines.push(renderDotNodeHtml(node, colors, theme.fontFamily));
    }
  }

  for (const edge of layout.edges) {
    const src = sanitizeDotId(edge.from);
    const tgt = sanitizeDotId(edge.to);
    const attrs: string[] = [];

    if (edge.reason) {
      attrs.push(`label="${edge.reason.replaceAll('"', '\\"')}"`);
    }
    if (edge.type === "scope_conflict") {
      attrs.push('style="dashed"');
      attrs.push(`color="${theme.edgeHighlight}"`);
    }
    if (edge.type === "prerequisite_gate") {
      attrs.push("penwidth=2.5");
    }

    const attrStr = attrs.length > 0 ? ` [${attrs.join(", ")}]` : "";
    lines.push(`  ${src} -> ${tgt}${attrStr};`);
  }

  lines.push("}");

  const content = lines.join("\n");

  return {
    format: "dot",
    content,
    mimeType: "text/vnd.graphviz",
    nodeCount: layout.nodes.length,
    edgeCount: layout.edges.length,
    layerCount: layout.metrics.totalWaves,
  };
}
