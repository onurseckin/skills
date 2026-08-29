import { computeOptimizedLayout } from "./layout-optimizer.ts";
import type {
  DagExportOptions,
  DagExportResult,
  DagLayoutNodePoint,
  DagOptimizedLayout,
  SugiyamaEdge,
  SugiyamaNode,
} from "./types.ts";

function formatBoxCharacters(style: "rounded" | "sharp" | "ascii"): {
  readonly tl: string;
  readonly tr: string;
  readonly bl: string;
  readonly br: string;
  readonly h: string;
  readonly v: string;
  readonly arrow: string;
} {
  if (style === "rounded") {
    return { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│", arrow: "▼" };
  }
  if (style === "sharp") {
    return { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│", arrow: "▼" };
  }
  return { tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|", arrow: "v" };
}

function padRight(str: string, length: number): string {
  if (str.length >= length) return str.slice(0, length);
  return str + " ".repeat(length - str.length);
}

function renderAsciiCard(
  node: DagLayoutNodePoint,
  box: ReturnType<typeof formatBoxCharacters>,
  cardWidth = 36,
): readonly string[] {
  const innerWidth = cardWidth - 2;
  const statusStr = `[${node.status.toUpperCase()}]`;
  const coordsStr = `W${node.wave}:L${node.lane}`;
  const topText = `${node.id} ${coordsStr}`;
  const firstLine = padRight(` ${topText} ${statusStr}`, innerWidth);

  let labelStr =
    node.label.length > innerWidth - 2 ? `${node.label.slice(0, innerWidth - 5)}...` : node.label;
  const secondLine = padRight(` ${labelStr}`, innerWidth);

  let agentStr = "";
  if (node.assignedAgent) {
    agentStr = ` Agent: ${node.assignedAgent}`;
  } else if (node.gate) {
    agentStr = ` Gate: ${node.gate}`;
  }
  const thirdLine = agentStr ? padRight(agentStr, innerWidth) : padRight("", innerWidth);

  const topBorder = box.tl + box.h.repeat(innerWidth) + box.tr;
  const line1 = box.v + firstLine + box.v;
  const line2 = box.v + secondLine + box.v;
  const line3 = box.v + thirdLine + box.v;
  const botBorder = box.bl + box.h.repeat(innerWidth) + box.br;

  return [topBorder, line1, line2, line3, botBorder];
}

export function exportDagToAscii(
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

  const box = formatBoxCharacters("rounded");
  const lines: string[] = [];

  if (options.title || layout.title) {
    const title = options.title || layout.title || "";
    const lineLen = Math.max(50, title.length + 8);
    lines.push(box.tl + box.h.repeat(lineLen - 2) + box.tr);
    lines.push(box.v + padRight(`  ${title}`, lineLen - 2) + box.v);
    lines.push(box.bl + box.h.repeat(lineLen - 2) + box.br);
    lines.push("");
  }

  const nodesByWave = new Map<number, DagLayoutNodePoint[]>();
  for (const node of layout.nodes) {
    const wave = node.wave;
    const group = nodesByWave.get(wave) ?? [];
    group.push(node);
    nodesByWave.set(wave, group);
  }

  const sortedWaves = [...nodesByWave.keys()].sort((a, b) => a - b);

  for (let wIdx = 0; wIdx < sortedWaves.length; wIdx++) {
    const wave = sortedWaves[wIdx]!;
    const waveNodes = nodesByWave.get(wave) ?? [];

    lines.push(
      `── Wave ${wave} (${waveNodes.length} task${waveNodes.length === 1 ? "" : "s"}) ──────────────────────────────────────`,
    );
    lines.push("");

    const renderedCards = waveNodes.map((n) => renderAsciiCard(n, box));
    const cardHeight = renderedCards[0]?.length ?? 0;

    for (let r = 0; r < cardHeight; r++) {
      const rowParts: string[] = [];
      for (const card of renderedCards) {
        rowParts.push(card[r] || "");
      }
      lines.push(`  ${rowParts.join("   ")}`);
    }

    lines.push("");

    if (wIdx < sortedWaves.length - 1) {
      lines.push("                           │");
      lines.push("                           ▼");
      lines.push("");
    }
  }

  if (layout.edges.length > 0) {
    lines.push("── Dependency Connectors & Forensics ──────────────────────");
    for (const edge of layout.edges) {
      const reasonStr = edge.reason ? ` [${edge.reason}]` : "";
      const typeStr = edge.type ? ` (${edge.type})` : "";
      lines.push(`  • ${edge.from} ──► ${edge.to}${typeStr}${reasonStr}`);
    }
    lines.push("");
  }

  lines.push("── Wave Metrics ───────────────────────────────────────────");
  lines.push(
    `  Total Waves: ${layout.metrics.totalWaves} | Span: ${layout.metrics.span} | Max Parallel Lanes: ${layout.metrics.maxParallelLanes}`,
  );
  lines.push(
    `  Total Work: ${layout.metrics.totalWork} | Parallelism Factor: ${layout.metrics.parallelismFactor}x | Optimal Concurrency: ${layout.metrics.optimalConcurrency}`,
  );
  lines.push("───────────────────────────────────────────────────────────");

  const content = lines.join("\n");

  return {
    format: "ascii",
    content,
    mimeType: "text/plain",
    nodeCount: layout.nodes.length,
    edgeCount: layout.edges.length,
    layerCount: layout.metrics.totalWaves,
  };
}
