import { computeOptimizedLayout } from "./layout-optimizer.ts";
import type {
  DagExportOptions,
  DagExportResult,
  DagLayoutNodePoint,
  DagOptimizedLayout,
  SugiyamaEdge,
  SugiyamaNode,
} from "./types.ts";

function sanitizeMermaidId(id: string): string {
  return id.replaceAll(/[^a-zA-Z0-9_]/g, "_");
}

function sanitizeMermaidLabel(text: string): string {
  return text.replaceAll('"', "'").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function renderMermaidNode(node: DagLayoutNodePoint): string {
  const safeId = sanitizeMermaidId(node.id);
  const label = sanitizeMermaidLabel(node.label);
  const status = sanitizeMermaidLabel(node.status);
  const coords = `W${node.wave}:L${node.lane}`;

  let extra = "";
  if (node.assignedAgent) {
    extra = `<br/>Agent: ${sanitizeMermaidLabel(node.assignedAgent)}`;
  } else if (node.gate) {
    extra = `<br/>Gate: ${sanitizeMermaidLabel(node.gate)}`;
  }

  const innerText = `"${node.id}<br/>${label}<br/>[${status}] [${coords}]${extra}"`;

  if (node.gate) {
    return `    ${safeId}{${innerText}}`;
  }
  if (node.status === "completed") {
    return `    ${safeId}([${innerText}])`;
  }
  if (node.status === "running" || node.status === "leased") {
    return `    ${safeId}[/${innerText}/]`;
  }
  return `    ${safeId}[${innerText}]`;
}

function renderMermaidEdge(edge: DagOptimizedLayout["edges"][number]): string {
  const src = sanitizeMermaidId(edge.from);
  const tgt = sanitizeMermaidId(edge.to);

  if (edge.reason) {
    const safeReason = sanitizeMermaidLabel(edge.reason);
    if (edge.type === "scope_conflict") {
      return `  ${src} -. "${safeReason}" .-> ${tgt}`;
    }
    return `  ${src} -- "${safeReason}" --> ${tgt}`;
  }

  if (edge.type === "scope_conflict") {
    return `  ${src} -.-> ${tgt}`;
  }
  if (edge.type === "prerequisite_gate") {
    return `  ${src} ==> ${tgt}`;
  }
  return `  ${src} --> ${tgt}`;
}

export function exportDagToMermaid(
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

  const direction = options.direction ?? "TD";
  const lines: string[] = [];

  if (options.title || layout.title) {
    const title = sanitizeMermaidLabel(options.title || layout.title || "");
    lines.push("---");
    lines.push(`title: ${title}`);
    lines.push("---");
  }

  lines.push(`flowchart ${direction}`);

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
      lines.push(`  subgraph Wave_${wave} ["Wave ${wave}"]`);
      for (const node of waveNodes) {
        lines.push(renderMermaidNode(node));
      }
      lines.push("  end");
    }
  } else {
    for (const node of layout.nodes) {
      lines.push(renderMermaidNode(node));
    }
  }

  for (const edge of layout.edges) {
    lines.push(renderMermaidEdge(edge));
  }

  lines.push("");
  lines.push("  classDef ready fill:#1f6feb22,stroke:#58a6ff,stroke-width:2px,color:#58a6ff;");
  lines.push("  classDef running fill:#d2992222,stroke:#d29922,stroke-width:2px,color:#e3b341;");
  lines.push("  classDef leased fill:#d2992222,stroke:#d29922,stroke-width:2px,color:#e3b341;");
  lines.push("  classDef validating fill:#a371f722,stroke:#bc8cff,stroke-width:2px,color:#d2a8ff;");
  lines.push("  classDef completed fill:#23863622,stroke:#3fb950,stroke-width:2px,color:#56d364;");
  lines.push("  classDef failed fill:#da363322,stroke:#f85149,stroke-width:2px,color:#ff7b72;");
  lines.push("  classDef blocked fill:#8b949e22,stroke:#8b949e,stroke-width:2px,color:#8b949e;");
  lines.push("  classDef proposed fill:#8b949e15,stroke:#6e7681,stroke-width:2px,color:#8b949e;");

  for (const node of layout.nodes) {
    const safeId = sanitizeMermaidId(node.id);
    const status = node.status.toLowerCase();
    lines.push(`  class ${safeId} ${status};`);
  }

  const content = lines.join("\n");

  return {
    format: "mermaid",
    content,
    mimeType: "text/vnd.mermaid",
    nodeCount: layout.nodes.length,
    edgeCount: layout.edges.length,
    layerCount: layout.metrics.totalWaves,
  };
}
