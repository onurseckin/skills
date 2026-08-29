import { countLayerCrossings, minimizeCrossingsBarycenter } from "./crossing.ts";
import { assignSugiyamaRanks } from "./ranking.ts";
import { renderRoundedNodeBox, renderSugiyamaNodeBox } from "./render-box.ts";
import { renderInterWaveConnector, renderLaneSeparator } from "./routing.ts";
import {
  detectCyclesTarjan,
  detectIllegalBypasses,
  extractFeedbackArcSet,
  reverseCycleEdges,
} from "./tarjan.ts";
import type {
  BypassDiagnostic,
  CycleDiagnostic,
  DirectedGraph,
  SugiyamaDagReport,
  SugiyamaEdge,
  SugiyamaLayer,
  SugiyamaNode,
  SugiyamaRankedNode,
  SugiyamaRenderOptions,
  SugiyamaWaveMetrics,
} from "./types.ts";

export { renderRoundedNodeBox, renderSugiyamaNodeBox } from "./render-box.ts";

export function renderSugiyamaDag(
  graphOrNodes: DirectedGraph | readonly SugiyamaNode[],
  edgesOrOptions?: readonly SugiyamaEdge[] | SugiyamaRenderOptions,
  options?: SugiyamaRenderOptions,
): {
  renderedDag: string;
  layers: readonly SugiyamaLayer[];
  rankedNodes: readonly SugiyamaRankedNode[];
  cycleDiagnostic: CycleDiagnostic;
  bypassDiagnostic: BypassDiagnostic;
} {
  const isArray = Array.isArray(graphOrNodes);
  const nodes: readonly SugiyamaNode[] = isArray
    ? (graphOrNodes as readonly SugiyamaNode[])
    : (graphOrNodes as DirectedGraph).nodes;
  const edges: readonly SugiyamaEdge[] = isArray
    ? Array.isArray(edgesOrOptions)
      ? (edgesOrOptions as readonly SugiyamaEdge[])
      : []
    : (graphOrNodes as DirectedGraph).edges;
  const opts: SugiyamaRenderOptions = isArray
    ? options ?? (!Array.isArray(edgesOrOptions) && typeof edgesOrOptions === "object" ? edgesOrOptions : {})
    : (typeof edgesOrOptions === "object" && !Array.isArray(edgesOrOptions) ? edgesOrOptions : options ?? {});

  const cycleDiagnostic = detectCyclesTarjan(nodes, edges);
  const bypassDiagnostic = detectIllegalBypasses(nodes, edges);

  if (nodes.length === 0) {
    return {
      renderedDag:
        "  ╭──────────────────────────────────────────────╮\n  │  (No tasks declared in planning buffer/graph) │\n  ╰──────────────────────────────────────────────╯",
      layers: [],
      rankedNodes: [],
      cycleDiagnostic,
      bypassDiagnostic,
    };
  }

  const { feedbackArcs, acyclicEdges } = extractFeedbackArcSet(nodes, edges);
  reverseCycleEdges(edges, feedbackArcs);

  const rankMap = assignSugiyamaRanks(
    nodes,
    acyclicEdges,
    cycleDiagnostic.cycleNodeIds,
    opts.maxWidth,
  );
  const maxRank = Math.max(0, ...[...rankMap.values()]);

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
    if (nodesInRank.length > 0) initialLayers.push({ rank: r, nodes: nodesInRank });
  }

  const optimizedLayers = minimizeCrossingsBarycenter(
    initialLayers,
    acyclicEdges,
    opts.passes ?? 4,
  );
  const flatRankedNodes = optimizedLayers.flatMap((l) => l.nodes);
  const lines: string[] = [];

  if (cycleDiagnostic.hasCycle) {
    lines.push("╔════════════════════════════════════════════════════════════════════════════╗");
    lines.push("║                         ⚡ [POISONOUS CYCLE] ⚡                            ║");
    lines.push("╠════════════════════════════════════════════════════════════════════════════╣");
    for (const path of cycleDiagnostic.cyclePaths)
      lines.push(`║ Cycle detected: ${path.join(" ➔ ")}`);
    for (const rem of cycleDiagnostic.remediation) lines.push(`║ Remediation:    ${rem}`);
    lines.push("╚════════════════════════════════════════════════════════════════════════════╝\n");
  }

  if (bypassDiagnostic.hasBypass) {
    lines.push("╔════════════════════════════════════════════════════════════════════════════╗");
    lines.push("║                        ❌ [ILLEGAL BYPASS]                                 ║");
    lines.push("╠════════════════════════════════════════════════════════════════════════════╣");
    for (const warning of bypassDiagnostic.warnings) lines.push(`║ ${warning}`);
    lines.push("╚════════════════════════════════════════════════════════════════════════════╝\n");
  }

  const cycleSet = new Set(cycleDiagnostic.cycleNodeIds);
  const bypassSet = new Set(bypassDiagnostic.bypasses.map((b) => b.to));

  for (let lIdx = 0; lIdx < optimizedLayers.length; lIdx++) {
    const layer = optimizedLayers[lIdx];
    if (!layer) continue;
    const waveNum = layer.rank + 1;
    const waveTasks = layer.nodes;

    const waveStatuses = [...new Set(waveTasks.map((t) => t.status))].join("/");
    const hasActiveTasks = waveTasks.some(
      (t) => t.status === "leased" || t.status === "running" || t.status === "validating",
    );
    const activeWaveBadge = hasActiveTasks ? " ⚡ [ACTIVE EXECUTION SUBGRAPH]" : "";
    const headerTitle = ` WAVE ${waveNum} (${waveTasks.length} ${waveTasks.length === 1 ? "lane" : "lanes"} • ${waveStatuses})${activeWaveBadge} `;
    const barLength = Math.max(10, 61 - headerTitle.length);
    lines.push(`╭─${headerTitle}${"─".repeat(barLength)}╮`);

    const isLastWave = lIdx === optimizedLayers.length - 1;

    for (let tIdx = 0; tIdx < waveTasks.length; tIdx++) {
      const task = waveTasks[tIdx];
      if (!task) continue;
      const isLastTaskInWave = tIdx === waveTasks.length - 1;

      lines.push(
        ...renderSugiyamaNodeBox(task, {
          detailed: opts.detailed,
          boxStyle: opts.boxStyle,
          boxWidth: opts.minBoxWidth ?? 63,
          isCycle: cycleSet.has(task.id),
          isBypass: bypassSet.has(task.id),
        }),
      );

      if (!isLastTaskInWave) lines.push(...renderLaneSeparator());
    }

    if (!isLastWave) {
      const nextLayer = optimizedLayers[lIdx + 1];
      if (nextLayer) lines.push(...renderInterWaveConnector(layer, nextLayer, edges));
    }
  }

  return {
    renderedDag: lines.join("\n"),
    layers: optimizedLayers,
    rankedNodes: flatRankedNodes,
    cycleDiagnostic,
    bypassDiagnostic,
  };
}

export function generateSugiyamaDagReport(
  nodes: readonly SugiyamaNode[],
  edges: readonly SugiyamaEdge[],
  options: SugiyamaRenderOptions & {
    runRoot?: string | undefined;
    runId?: string | undefined;
    isCompiled?: boolean | undefined;
    graphRevision?: number | null | undefined;
    maxParallel?: number | undefined;
  } = {},
): SugiyamaDagReport {
  const { renderedDag, layers, rankedNodes, cycleDiagnostic, bypassDiagnostic } = renderSugiyamaDag(
    nodes,
    edges,
    options,
  );

  const totalWork = nodes.reduce(
    (acc, t) => acc + (typeof t.effort === "number" ? t.effort : 1),
    0,
  );
  const maxCriticalPath = Math.max(
    layers.length > 0 ? layers.length : 1,
    ...nodes.map((n) => (typeof n.criticalDepth === "number" ? n.criticalDepth + 1 : 1)),
  );
  const span = maxCriticalPath;
  const parallelismFactor = span > 0 ? Number((totalWork / span).toFixed(2)) : 0;
  const maxParallel = options.maxParallel ?? 4;
  const optimalConcurrency = Math.min(maxParallel, Math.max(1, Math.ceil(nodes.length / 2)));
  const maxLayerWidth = layers.length > 0 ? Math.max(...layers.map((l) => l.nodes.length)) : 0;

  let totalCrossings = 0;
  for (let i = 0; i < layers.length - 1; i++) {
    const l1 = layers[i];
    const l2 = layers[i + 1];
    if (l1 && l2) totalCrossings += countLayerCrossings(l1.nodes, l2.nodes, edges);
  }

  const metrics: SugiyamaWaveMetrics = {
    totalWaves: layers.length,
    maxParallelLanes: maxLayerWidth,
    criticalPathLength: maxCriticalPath,
    averageWaveConcurrency:
      layers.length > 0 ? Number((nodes.length / layers.length).toFixed(2)) : 0,
    serialBottlenecks: nodes.filter((n) => (n.descendantCount ?? 0) >= 3).length,
    parallelEligibleChains: 0,
    totalWork,
    span,
    parallelismFactor,
    optimalConcurrency,
  };

  const isCompiled = options.isCompiled ?? true;
  const graphRevision = options.graphRevision ?? 1;
  const runId = options.runId ?? "capsule-run";

  const mdSections: string[] = [
    `### Sugiyama Hierarchical DAG Visualization: ${runId}`,
    `- **Graph Status**: ${isCompiled ? `Compiled (Revision ${graphRevision})` : "Draft (Planning Buffer)"}`,
    `- **Total Tasks**: ${nodes.length} across ${layers.length} Sugiyama wave rank(s)`,
    `- **Critical Path**: ${maxCriticalPath} wave(s) | **Max Parallel Capacity**: ${maxParallel} lanes | **Work/Span (P)**: ${parallelismFactor}`,
    "",
    "#### Live Unicode DAG Layout",
    "```text",
    renderedDag,
    "```",
  ];

  if (cycleDiagnostic.hasCycle) {
    mdSections.push("", "#### ⚡ [POISONOUS CYCLE] ⚡");
    for (const path of cycleDiagnostic.cyclePaths)
      mdSections.push(`- **Cycle Path**: ${path.join(" ➔ ")}`);
    for (const rem of cycleDiagnostic.remediation) mdSections.push(`- **Remediation**: ${rem}`);
  }

  if (bypassDiagnostic.hasBypass) {
    mdSections.push("", "#### ❌ [ILLEGAL BYPASS] ❌");
    for (const w of bypassDiagnostic.warnings) mdSections.push(`- ${w}`);
  }

  return {
    markdown: mdSections.join("\n"),
    renderedDag,
    layers,
    nodes: rankedNodes,
    cycleDiagnostic,
    bypassDiagnostic,
    metrics,
    isCompiled,
    graphRevision,
    totalTasks: nodes.length,
    totalNodes: nodes.length,
    totalLayers: layers.length,
    maxLayerWidth,
    totalCrossings,
    renderedAscii: renderedDag,
  };
}

export function buildSugiyamaDagReport(
  nodes: readonly SugiyamaNode[],
  edges: readonly SugiyamaEdge[],
  options: SugiyamaRenderOptions & {
    runRoot?: string | undefined;
    runId?: string | undefined;
    isCompiled?: boolean | undefined;
    graphRevision?: number | null | undefined;
    maxParallel?: number | undefined;
  } = {},
): SugiyamaDagReport {
  return generateSugiyamaDagReport(nodes, edges, options);
}
