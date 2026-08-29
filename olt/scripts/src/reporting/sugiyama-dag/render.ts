/**
 * Sugiyama DAG Visual Renderer & Report Builder Subsystem
 */
import { assignSugiyamaRanks } from "./ranking.ts";
import { minimizeCrossingsBarycenter } from "./crossing.ts";
import { detectCyclesTarjan, detectIllegalBypasses } from "./tarjan.ts";
import { renderRoundedNodeBox } from "./render-box.ts";
import { renderInterWaveConnector, renderLaneSeparator } from "./routing.ts";
import type {
  BypassDiagnostic,
  CycleDiagnostic,
  SugiyamaDagReport,
  SugiyamaEdge,
  SugiyamaLayer,
  SugiyamaNode,
  SugiyamaRankedNode,
  SugiyamaRenderOptions,
  SugiyamaWaveMetrics,
} from "./types.ts";

export { renderRoundedNodeBox } from "./render-box.ts";

/**
 * Builds and renders the full Sugiyama DAG layout with orthogonal routing and diagnostics.
 */
export function renderSugiyamaDag(
  nodes: readonly SugiyamaNode[],
  edges: readonly SugiyamaEdge[],
  options: SugiyamaRenderOptions = {},
): {
  renderedDag: string;
  layers: readonly SugiyamaLayer[];
  rankedNodes: readonly SugiyamaRankedNode[];
  cycleDiagnostic: CycleDiagnostic;
  bypassDiagnostic: BypassDiagnostic;
} {
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

  const rankMap = assignSugiyamaRanks(nodes, edges, cycleDiagnostic.cycleNodeIds);
  const maxRank = Math.max(0, ...[...rankMap.values()]);

  const initialLayers: SugiyamaLayer[] = [];
  for (let r = 0; r <= maxRank; r++) {
    const nodesInRank = nodes
      .filter((n) => (rankMap.get(n.id) ?? 0) === r)
      .map((n, order) => ({
        ...n,
        rank: r,
        order,
        wave: n.wave ?? r + 1,
        lane: n.lane ?? order + 1,
        coordinates: n.coordinates ?? {
          wave: n.wave ?? r + 1,
          lane: n.lane ?? order + 1,
          rank: r,
          order,
        },
      }));
    if (nodesInRank.length > 0) {
      initialLayers.push({ rank: r, nodes: nodesInRank });
    }
  }

  const optimizedLayers = minimizeCrossingsBarycenter(initialLayers, edges);
  const flatRankedNodes = optimizedLayers.flatMap((l) => l.nodes);
  const lines: string[] = [];

  if (cycleDiagnostic.hasCycle) {
    lines.push("╔════════════════════════════════════════════════════════════════════════════╗");
    lines.push("║                         ⚡ [POISONOUS CYCLE] ⚡                            ║");
    lines.push("╠════════════════════════════════════════════════════════════════════════════╣");
    for (const path of cycleDiagnostic.cyclePaths) {
      lines.push(`║ Cycle detected: ${path.join(" ➔ ")}`);
    }
    for (const rem of cycleDiagnostic.remediation) {
      lines.push(`║ Remediation:    ${rem}`);
    }
    lines.push("╚════════════════════════════════════════════════════════════════════════════╝");
    lines.push("");
  }

  if (bypassDiagnostic.hasBypass) {
    lines.push("╔════════════════════════════════════════════════════════════════════════════╗");
    lines.push("║                        ❌ [ILLEGAL BYPASS]                                 ║");
    lines.push("╠════════════════════════════════════════════════════════════════════════════╣");
    for (const warning of bypassDiagnostic.warnings) {
      lines.push(`║ ${warning}`);
    }
    lines.push("╚════════════════════════════════════════════════════════════════════════════╝");
    lines.push("");
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
    const headerLine = `╭─${headerTitle}${"─".repeat(barLength)}╮`;
    lines.push(headerLine);

    const isLastWave = lIdx === optimizedLayers.length - 1;

    for (let tIdx = 0; tIdx < waveTasks.length; tIdx++) {
      const task = waveTasks[tIdx];
      if (!task) continue;
      const isLastTaskInWave = tIdx === waveTasks.length - 1;

      const isNodeInCycle = cycleSet.has(task.id);
      const isNodeInBypass = bypassSet.has(task.id);

      const boxLines = renderRoundedNodeBox(task, {
        detailed: options.detailed,
        boxStyle: options.boxStyle,
        boxWidth: options.minBoxWidth ?? 63,
        isCycle: isNodeInCycle,
        isBypass: isNodeInBypass,
      });

      lines.push(...boxLines);

      if (!isLastTaskInWave) {
        lines.push(...renderLaneSeparator());
      }
    }

    if (!isLastWave) {
      const nextLayer = optimizedLayers[lIdx + 1];
      if (nextLayer) {
        lines.push(...renderInterWaveConnector(layer, nextLayer, edges));
      }
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

/**
 * Builds the complete Sugiyama DAG Report including markdown formatting and metrics.
 */
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
    1,
    ...nodes.map((n) => (typeof n.criticalDepth === "number" ? n.criticalDepth + 1 : 1)),
  );
  const span = maxCriticalPath;
  const parallelismFactor = span > 0 ? Number((totalWork / span).toFixed(2)) : 0;
  const maxParallel = options.maxParallel ?? 4;
  const optimalConcurrency = Math.min(maxParallel, Math.max(1, Math.ceil(nodes.length / 2)));

  const metrics: SugiyamaWaveMetrics = {
    totalWaves: layers.length,
    maxParallelLanes: layers.length > 0 ? Math.max(...layers.map((l) => l.nodes.length)) : 0,
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
    mdSections.push("");
    mdSections.push("#### ⚡ [POISONOUS CYCLE] ⚡");
    for (const path of cycleDiagnostic.cyclePaths) {
      mdSections.push(`- **Cycle Path**: ${path.join(" ➔ ")}`);
    }
    for (const rem of cycleDiagnostic.remediation) {
      mdSections.push(`- **Remediation**: ${rem}`);
    }
  }

  if (bypassDiagnostic.hasBypass) {
    mdSections.push("");
    mdSections.push("#### ❌ [ILLEGAL BYPASS] ❌");
    for (const w of bypassDiagnostic.warnings) {
      mdSections.push(`- ${w}`);
    }
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
  };
}
