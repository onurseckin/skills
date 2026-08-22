/**
 * Sugiyama Hierarchical DAG Renderer & Visual Diagnostics Subsystem
 * Implements layered ranking, barycenter crossing minimization, Tarjan cycle alerts, and orthogonal routing.
 */
import { HarnessError } from "../errors/harness-error.ts";
import { scopeConflict } from "../scheduler/conflicts.ts";
import { schedulingMetrics, type SchedulingMetrics } from "../scheduler/metrics.ts";

export interface SugiyamaSubtask {
  readonly id: string;
  readonly label?: string | undefined;
  readonly status?: string | undefined;
  readonly assignedAgent?: string | null | undefined;
  readonly validatorAgent?: string | null | undefined;
  readonly validatorId?: string | null | undefined;
  readonly implementerAgent?: string | null | undefined;
  readonly role?: string | undefined;
  readonly coordinates?:
    | { readonly wave?: number; readonly lane?: number; readonly rank?: number; readonly order?: number }
    | string
    | undefined;
  readonly writeScope?: readonly string[] | undefined;
}

export interface SugiyamaNode {
  readonly id: string;
  readonly label: string;
  readonly status: string;
  readonly dependencies: readonly string[];
  readonly writeScope?: readonly string[] | undefined;
  readonly resourceScope?: readonly string[] | undefined;
  readonly gate?: string | undefined;
  readonly assignedAgent?: string | null | undefined;
  readonly assignedRole?: string | null | undefined;
  readonly assignedTool?: string | null | undefined;
  readonly validatorAgent?: string | null | undefined;
  readonly validatorId?: string | null | undefined;
  readonly implementerAgent?: string | null | undefined;
  readonly attempt?: number | null | undefined;
  readonly priority?: number | undefined;
  readonly effort?: number | undefined;
  readonly criticalDepth?: number | undefined;
  readonly descendantCount?: number | undefined;
  readonly depReasons?: Readonly<Record<string, string>> | undefined;
  readonly isDummy?: boolean | undefined;
  readonly origSource?: string | undefined;
  readonly origTarget?: string | undefined;
  readonly coordinates?:
    | { readonly wave?: number; readonly lane?: number; readonly rank?: number; readonly order?: number }
    | string
    | undefined;
  readonly wave?: number | undefined;
  readonly lane?: number | undefined;
  readonly parentTaskId?: string | undefined;
  readonly branchId?: string | undefined;
  readonly round?: number | undefined;
  readonly probeRound?: number | undefined;
  readonly expandedSubtasks?: readonly (SugiyamaNode | SugiyamaSubtask | string)[] | undefined;
  readonly dynamicOrigin?:
    | "static"
    | "dynamic_expansion"
    | "branch"
    | "replan"
    | "repair_branch"
    | undefined;
}

export interface SugiyamaEdge {
  readonly from: string;
  readonly to: string;
  readonly type?:
    | "dataflow"
    | "scope_conflict"
    | "explicit_justification"
    | "prerequisite_gate"
    | "declared_dep"
    | "virtual"
    | undefined;
  readonly reason?: string | undefined;
}

export interface SugiyamaRankedNode extends SugiyamaNode {
  readonly rank: number;
  readonly order: number;
  readonly x?: number | undefined;
  readonly y?: number | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
}

export interface SugiyamaLayer {
  readonly rank: number;
  readonly nodes: readonly SugiyamaRankedNode[];
}

export interface CycleDiagnostic {
  readonly hasCycle: boolean;
  readonly cyclePaths: readonly (readonly string[])[];
  readonly cycleEdges: readonly { readonly from: string; readonly to: string }[];
  readonly alert: string;
  readonly remediation: readonly string[];
  readonly cycleNodeIds: readonly string[];
}

export interface BypassDiagnosticItem {
  readonly from: string;
  readonly to: string;
  readonly intermediatePath: readonly string[];
  readonly reason: string;
}

export interface BypassDiagnostic {
  readonly hasBypass: boolean;
  readonly bypasses: readonly BypassDiagnosticItem[];
  readonly alert: string;
  readonly warnings: readonly string[];
}

export interface SugiyamaWaveMetrics {
  readonly totalWaves: number;
  readonly maxParallelLanes: number;
  readonly criticalPathLength: number;
  readonly averageWaveConcurrency: number;
  readonly serialBottlenecks: number;
  readonly parallelEligibleChains: number;
  readonly totalWork: number;
  readonly span: number;
  readonly parallelismFactor: number;
  readonly optimalConcurrency: number;
}

export interface SugiyamaRenderOptions {
  readonly detailed?: boolean | undefined;
  readonly boxStyle?: "rounded" | "sharp" | "ascii" | undefined;
  readonly minBoxWidth?: number | undefined;
  readonly showDiagnostics?: boolean | undefined;
  readonly showForensics?: boolean | undefined;
  readonly title?: string | undefined;
}

export interface SugiyamaDagReport {
  readonly markdown: string;
  readonly renderedDag: string;
  readonly layers: readonly SugiyamaLayer[];
  readonly nodes: readonly SugiyamaRankedNode[];
  readonly cycleDiagnostic: CycleDiagnostic;
  readonly bypassDiagnostic: BypassDiagnostic;
  readonly metrics: SugiyamaWaveMetrics;
  readonly isCompiled: boolean;
  readonly graphRevision: number | null;
  readonly totalTasks: number;
}

/**
 * Returns live status badge and glyph.
 */
export function getStatusBadge(status: string, hasDeps = false): string {
  switch (status.toLowerCase()) {
    case "pass":
      return "✓ PASS";
    case "done":
    case "satisfied":
    case "passed":
      return "✓ PASSED";
    case "active":
      return "● ACTIVE";
    case "leased":
    case "running":
      return "🟢 RUNNING";
    case "probing":
    case "probe":
    case "investigating":
      return "🔍 PROBING";
    case "repairing":
    case "repair":
    case "remediation":
      return "⟳ REPAIRING";
    case "validating":
      return "🔄 VALIDATING";
    case "validated":
      return "🟣 VALIDATED";
    case "ready":
    case "retry_ready":
      return "○ READY";
    case "draft":
      return hasDeps ? "⏳ BLOCKED" : "○ READY";
    case "changes_requested":
      return "🔴 CHANGES_REQ";
    case "failed":
    case "rejected":
      return "❌ REJECTED";
    case "escalated":
      return "🚨 ESCALATED";
    case "proposed":
    case "blocked":
    default:
      return "⏳ BLOCKED";
  }
}

export function getStatusGlyph(status: string, hasDeps = false): string {
  return `(${getStatusBadge(status, hasDeps)})`;
}

/**
 * Returns boxed bracket status badges for dynamic DAG visualization.
 * Supported badges: [● ACTIVE], [✓ PASS], [○ READY], [⟳ REPAIRING], [🔍 PROBING], etc.
 */
export function formatStatusBadge(status: string, hasDeps = false): string {
  switch (status.toLowerCase()) {
    case "active":
    case "leased":
    case "running":
    case "in_progress":
      return "[● ACTIVE]";
    case "pass":
    case "done":
    case "satisfied":
    case "passed":
      return "[✓ PASS]";
    case "ready":
    case "retry_ready":
      return "[○ READY]";
    case "repairing":
    case "repair":
    case "changes_requested":
    case "remediation":
      return "[⟳ REPAIRING]";
    case "probing":
    case "probe":
    case "investigating":
      return "[🔍 PROBING]";
    case "validating":
      return "[🔄 VALIDATING]";
    case "validated":
      return "[🟣 VALIDATED]";
    case "failed":
    case "rejected":
      return "[❌ REJECTED]";
    case "escalated":
      return "[🚨 ESCALATED]";
    case "proposed":
    case "blocked":
      return "[⏳ BLOCKED]";
    case "draft":
    default:
      return hasDeps ? "[⏳ BLOCKED]" : "[○ READY]";
  }
}

/**
 * Formats subagent allocation relationship string:
 * [● IMPLEMENTER: <agent-id> ──► VALIDATOR: <agent-id>]
 */
export function formatSubagentAllocation(
  implementerId?: string | null,
  validatorId?: string | null,
  implementerRole = "IMPLEMENTER",
): string {
  const cleanImpl = implementerId?.trim();
  const cleanVal = validatorId?.trim();

  if (cleanImpl && cleanVal) {
    const roleUpper = implementerRole.toUpperCase();
    return `[● ${roleUpper}: ${cleanImpl} ──► VALIDATOR: ${cleanVal}]`;
  }
  if (cleanImpl) {
    const roleUpper = implementerRole.toUpperCase();
    return `[● ${roleUpper}: ${cleanImpl}]`;
  }
  if (cleanVal) {
    return `[● VALIDATOR: ${cleanVal}]`;
  }
  return "";
}

/**
 * Formats wave/lane coordinates: [W<wave>:L<lane>]
 */
export function formatCoordinates(
  coordinates?:
    | { readonly wave?: number; readonly lane?: number; readonly rank?: number; readonly order?: number }
    | string
    | null,
  waveFallback?: number,
  laneFallback?: number,
): string {
  if (typeof coordinates === "string" && coordinates.trim().length > 0) {
    const trimmed = coordinates.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) return trimmed;
    return `[${trimmed}]`;
  }
  if (coordinates && typeof coordinates === "object") {
    const wave = coordinates.wave ?? (coordinates.rank !== undefined ? coordinates.rank + 1 : 1);
    const lane = coordinates.lane ?? (coordinates.order !== undefined ? coordinates.order + 1 : 1);
    return `[W${wave}:L${lane}]`;
  }
  if (waveFallback !== undefined || laneFallback !== undefined) {
    const wave = waveFallback ?? 1;
    const lane = laneFallback ?? 1;
    return `[W${wave}:L${lane}]`;
  }
  return "";
}

/**
 * Tarjan cycle detection to find all strongly connected components (SCCs) and cycles.
 */
export function detectCyclesTarjan(
  nodes: readonly SugiyamaNode[],
  edges: readonly SugiyamaEdge[],
): CycleDiagnostic {
  const nodeMap = new Map<string, SugiyamaNode>(nodes.map((n) => [n.id, n]));
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    adj.set(n.id, []);
  }
  for (const e of edges) {
    if (adj.has(e.from)) {
      adj.get(e.from)?.push(e.to);
    }
  }

  let index = 0;
  const indices = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const onStack = new Map<string, boolean>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  function strongConnect(v: string): void {
    indices.set(v, index);
    lowlinks.set(v, index);
    index += 1;
    stack.push(v);
    onStack.set(v, true);

    const neighbors = adj.get(v) ?? [];
    for (const w of neighbors) {
      if (!indices.has(w)) {
        strongConnect(w);
        const lowV = lowlinks.get(v) ?? 0;
        const lowW = lowlinks.get(w) ?? 0;
        lowlinks.set(v, Math.min(lowV, lowW));
      } else if (onStack.get(w)) {
        const lowV = lowlinks.get(v) ?? 0;
        const idxW = indices.get(w) ?? 0;
        lowlinks.set(v, Math.min(lowV, idxW));
      }
    }

    if (lowlinks.get(v) === indices.get(v)) {
      const scc: string[] = [];
      let w: string | undefined;
      do {
        w = stack.pop();
        if (w !== undefined) {
          onStack.set(w, false);
          scc.push(w);
        }
      } while (w !== undefined && w !== v);

      if (scc.length > 1) {
        sccs.push(scc);
      } else if (scc.length === 1 && scc[0] !== undefined) {
        // Check for self-loop
        const singleNode = scc[0];
        if (adj.get(singleNode)?.includes(singleNode)) {
          sccs.push(scc);
        }
      }
    }
  }

  for (const n of nodes) {
    if (!indices.has(n.id)) {
      strongConnect(n.id);
    }
  }

  if (sccs.length === 0) {
    return {
      hasCycle: false,
      cyclePaths: [],
      cycleEdges: [],
      alert: "",
      remediation: [],
      cycleNodeIds: [],
    };
  }

  const cyclePaths: string[][] = [];
  const cycleEdges: { from: string; to: string }[] = [];
  const remediation: string[] = [];
  const cycleNodeSet = new Set<string>();

  for (const scc of sccs) {
    for (const id of scc) {
      cycleNodeSet.add(id);
    }

    if (scc.length === 1 && scc[0] !== undefined) {
      const single = scc[0];
      cyclePaths.push([single, single]);
      cycleEdges.push({ from: single, to: single });
      remediation.push(`Drop self-dependency on task ${single}`);
      continue;
    }

    // Trace cycle path within SCC
    const sccSet = new Set(scc);
    const start = scc[0]!;
    const path: string[] = [start];
    const visitedInPath = new Set<string>([start]);
    let curr = start;

    let foundCycle = false;
    for (let step = 0; step < scc.length + 5 && !foundCycle; step++) {
      const nextCandidates = (adj.get(curr) ?? []).filter((nextId) => sccSet.has(nextId));
      if (nextCandidates.length === 0) break;
      const next = nextCandidates[0]!;
      if (next === start || visitedInPath.has(next)) {
        path.push(next);
        foundCycle = true;
      } else {
        path.push(next);
        visitedInPath.add(next);
        curr = next;
      }
    }

    cyclePaths.push(path);
    for (let i = 0; i < path.length - 1; i++) {
      const fromNode = path[i]!;
      const toNode = path[i + 1]!;
      cycleEdges.push({ from: fromNode, to: toNode });
    }
    const firstEdge = `${path[0]} ➔ ${path[1] ?? path[0]}`;
    remediation.push(
      `Drop edge [${firstEdge}] or re-sequence tasks to break dependency cycle (${path.join(" ➔ ")})`,
    );
  }

  return {
    hasCycle: true,
    cyclePaths,
    cycleEdges,
    alert: "⚡ [POISONOUS CYCLE] ⚡",
    remediation,
    cycleNodeIds: [...cycleNodeSet],
  };
}

/**
 * Detects illegal transitive bypasses and layering violations.
 * A bypass occurs when an edge u -> v exists directly, but there is also a longer path u -> ... -> v
 * with >= 2 hops, bypassing intermediate invariants.
 */
export function detectIllegalBypasses(
  nodes: readonly SugiyamaNode[],
  edges: readonly SugiyamaEdge[],
): BypassDiagnostic {
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    adj.set(n.id, []);
  }
  for (const e of edges) {
    if (adj.has(e.from)) {
      adj.get(e.from)?.push(e.to);
    }
  }

  function findAllPaths(start: string, target: string, maxDepth = 6): string[][] {
    const paths: string[][] = [];
    function dfs(curr: string, currentPath: string[]): void {
      if (currentPath.length > maxDepth) return;
      if (curr === target) {
        if (currentPath.length > 2) {
          paths.push([...currentPath]);
        }
        return;
      }
      const neighbors = adj.get(curr) ?? [];
      for (const next of neighbors) {
        if (!currentPath.includes(next)) {
          currentPath.push(next);
          dfs(next, currentPath);
          currentPath.pop();
        }
      }
    }
    dfs(start, [start]);
    return paths;
  }

  const bypassItems: BypassDiagnosticItem[] = [];
  const warnings: string[] = [];

  for (const e of edges) {
    const longerPaths = findAllPaths(e.from, e.to);
    if (longerPaths.length > 0) {
      for (const p of longerPaths) {
        const intermediate = p.slice(1, -1);
        const reason = `Direct edge [${e.from} ➔ ${e.to}] bypasses required intermediate stage (${intermediate.join(" ➔ ")})`;
        bypassItems.push({
          from: e.from,
          to: e.to,
          intermediatePath: intermediate,
          reason,
        });
        warnings.push(`❌ [ILLEGAL BYPASS]: ${reason}`);
      }
    }
  }

  return {
    hasBypass: bypassItems.length > 0,
    bypasses: bypassItems,
    alert: bypassItems.length > 0 ? "❌ [ILLEGAL BYPASS]" : "",
    warnings,
  };
}

/**
 * Step 1: Assign nodes to discrete rank layers using longest-path leveling.
 */
export function assignSugiyamaRanks(
  nodes: readonly SugiyamaNode[],
  edges: readonly SugiyamaEdge[],
  cycleNodeIds: readonly string[] = [],
): Map<string, number> {
  const rankMap = new Map<string, number>();
  const cycleSet = new Set(cycleNodeIds);

  // Filter out cycle back-edges to calculate ranks safely
  const acyclicEdges = edges.filter(
    (e) => !cycleSet.has(e.from) || !cycleSet.has(e.to) || e.from === e.to,
  );

  // In-degree computation
  const inDegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const n of nodes) {
    inDegree.set(n.id, 0);
    outgoing.set(n.id, []);
    rankMap.set(n.id, 0);
  }

  for (const e of acyclicEdges) {
    if (e.from === e.to) continue;
    if (inDegree.has(e.to) && outgoing.has(e.from)) {
      inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
      outgoing.get(e.from)?.push(e.to);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) {
      queue.push(id);
      rankMap.set(id, 0);
    }
  }

  const visited = new Set<string>();
  while (queue.length > 0) {
    const curr = queue.shift()!;
    visited.add(curr);
    const currRank = rankMap.get(curr) ?? 0;
    const children = outgoing.get(curr) ?? [];

    for (const child of children) {
      const existingRank = rankMap.get(child) ?? 0;
      if (currRank + 1 > existingRank) {
        rankMap.set(child, currRank + 1);
      }
      const remainingDeg = (inDegree.get(child) ?? 1) - 1;
      inDegree.set(child, remainingDeg);
      if (remainingDeg === 0) {
        queue.push(child);
      }
    }
  }

  // Handle any remaining nodes in cycles
  for (const n of nodes) {
    if (!visited.has(n.id)) {
      let maxParentRank = -1;
      for (const e of edges) {
        if (e.to === n.id && e.from !== n.id) {
          const pRank = rankMap.get(e.from) ?? 0;
          if (pRank > maxParentRank) {
            maxParentRank = pRank;
          }
        }
      }
      rankMap.set(n.id, maxParentRank >= 0 ? maxParentRank + 1 : 0);
    }
  }

  return rankMap;
}

/**
 * Step 2: Crossing minimization using Barycenter heuristic.
 */
export function minimizeCrossingsBarycenter(
  layers: readonly SugiyamaLayer[],
  edges: readonly SugiyamaEdge[],
  passes = 4,
): SugiyamaLayer[] {
  if (layers.length <= 1) {
    return layers.map((l) => ({ ...l }));
  }

  // Create mutable working layers
  let currentLayers: SugiyamaRankedNode[][] = layers.map((l) => [...l.nodes]);

  const adjDown = new Map<string, string[]>();
  const adjUp = new Map<string, string[]>();

  for (const e of edges) {
    if (!adjDown.has(e.from)) adjDown.set(e.from, []);
    if (!adjUp.has(e.to)) adjUp.set(e.to, []);
    adjDown.get(e.from)?.push(e.to);
    adjUp.get(e.to)?.push(e.from);
  }

  function countCrossingsBetween(
    layerA: readonly SugiyamaRankedNode[],
    layerB: readonly SugiyamaRankedNode[],
  ): number {
    let crossings = 0;
    const posB = new Map<string, number>();
    for (let i = 0; i < layerB.length; i++) {
      posB.set(layerB[i]!.id, i);
    }

    const edgePairs: { aPos: number; bPos: number }[] = [];
    for (let aIdx = 0; aIdx < layerA.length; aIdx++) {
      const u = layerA[aIdx]!.id;
      const targets = adjDown.get(u) ?? [];
      for (const v of targets) {
        if (posB.has(v)) {
          edgePairs.push({ aPos: aIdx, bPos: posB.get(v)! });
        }
      }
    }

    for (let i = 0; i < edgePairs.length; i++) {
      for (let j = i + 1; j < edgePairs.length; j++) {
        const e1 = edgePairs[i]!;
        const e2 = edgePairs[j]!;
        if ((e1.aPos < e2.aPos && e1.bPos > e2.bPos) || (e1.aPos > e2.aPos && e1.bPos < e2.bPos)) {
          crossings += 1;
        }
      }
    }
    return crossings;
  }

  function totalCrossings(layerList: readonly (readonly SugiyamaRankedNode[])[]): number {
    let total = 0;
    for (let i = 0; i < layerList.length - 1; i++) {
      total += countCrossingsBetween(layerList[i]!, layerList[i + 1]!);
    }
    return total;
  }

  let bestCrossings = totalCrossings(currentLayers);
  let bestLayers = currentLayers.map((l) => [...l]);

  for (let p = 0; p < passes; p++) {
    // Forward pass (downwards)
    for (let r = 1; r < currentLayers.length; r++) {
      const prevLayer = currentLayers[r - 1]!;
      const currLayer = currentLayers[r]!;
      const posMap = new Map<string, number>();
      for (let i = 0; i < prevLayer.length; i++) {
        posMap.set(prevLayer[i]!.id, i);
      }

      const barycenters = currLayer.map((node, originalIndex) => {
        const parents = adjUp.get(node.id) ?? [];
        const validPositions = parents
          .filter((pId) => posMap.has(pId))
          .map((pId) => posMap.get(pId)!);
        const bc =
          validPositions.length > 0
            ? validPositions.reduce((acc, val) => acc + val, 0) / validPositions.length
            : originalIndex;
        return { node, bc, originalIndex };
      });

      barycenters.sort((a, b) => (a.bc !== b.bc ? a.bc - b.bc : a.originalIndex - b.originalIndex));
      currentLayers[r] = barycenters.map((b) => b.node);
    }

    // Backward pass (upwards)
    for (let r = currentLayers.length - 2; r >= 0; r--) {
      const nextLayer = currentLayers[r + 1]!;
      const currLayer = currentLayers[r]!;
      const posMap = new Map<string, number>();
      for (let i = 0; i < nextLayer.length; i++) {
        posMap.set(nextLayer[i]!.id, i);
      }

      const barycenters = currLayer.map((node, originalIndex) => {
        const children = adjDown.get(node.id) ?? [];
        const validPositions = children
          .filter((cId) => posMap.has(cId))
          .map((cId) => posMap.get(cId)!);
        const bc =
          validPositions.length > 0
            ? validPositions.reduce((acc, val) => acc + val, 0) / validPositions.length
            : originalIndex;
        return { node, bc, originalIndex };
      });

      barycenters.sort((a, b) => (a.bc !== b.bc ? a.bc - b.bc : a.originalIndex - b.originalIndex));
      currentLayers[r] = barycenters.map((b) => b.node);
    }

    const currentScore = totalCrossings(currentLayers);
    if (currentScore < bestCrossings) {
      bestCrossings = currentScore;
      bestLayers = currentLayers.map((l) => [...l]);
    }
  }

  return bestLayers.map((nodesInRank, rank) => ({
    rank,
    nodes: nodesInRank.map((node, order) => ({
      ...node,
      rank,
      order,
      wave: node.wave ?? rank + 1,
      lane: node.lane ?? order + 1,
      coordinates: node.coordinates ?? {
        wave: node.wave ?? rank + 1,
        lane: node.lane ?? order + 1,
        rank,
        order,
      },
    })),
  }));
}

/**
 * Renders a single rounded Unicode node box.
 */
export function renderRoundedNodeBox(
  task: SugiyamaNode,
  options: {
    detailed?: boolean | undefined;
    boxStyle?: "rounded" | "sharp" | "ascii" | undefined;
    boxWidth?: number | undefined;
    isCycle?: boolean | undefined;
    isBypass?: boolean | undefined;
  } = {},
): string[] {
  const glyph = getStatusGlyph(task.status, task.dependencies.length > 0);
  const style = options.boxStyle ?? "rounded";

  let cornerTL = "╭";
  let cornerTR = "╮";
  let cornerBL = "╰";
  let cornerBR = "╯";
  let horiz = "─";
  let vert = "│";

  if (style === "sharp") {
    cornerTL = "┌";
    cornerTR = "┐";
    cornerBL = "└";
    cornerBR = "┘";
  } else if (style === "ascii") {
    cornerTL = "+";
    cornerTR = "+";
    cornerBL = "+";
    cornerBR = "+";
    horiz = "-";
    vert = "|";
  }

  const cycleBadge = options.isCycle ? " ⚡[CYCLE]" : "";
  const bypassBadge = options.isBypass ? " ❌[BYPASS]" : "";
  const agentBadge =
    task.assignedAgent &&
    (task.status === "leased" ||
      task.status === "running" ||
      task.status === "validating" ||
      task.status === "active")
      ? ` [⚡ ${task.status === "validating" ? "VALIDATING" : "LEASED"}: ${task.assignedAgent} (${task.assignedRole ?? "implementer"})]`
      : "";

  const labelSuffix = task.label && task.label !== task.id ? ` • ${task.label}` : "";
  const titleLine = `${glyph} ${task.id}${labelSuffix}${agentBadge}${cycleBadge}${bypassBadge}`;

  const role = task.assignedRole ?? (task.assignedAgent ? "implementer" : "unassigned");
  const work = typeof task.effort === "number" ? task.effort : 1;
  const span = typeof task.criticalDepth === "number" ? task.criticalDepth + 1 : 1;

  const rows: string[] = [titleLine];

  // Active Subagent Allocation rendering: [● IMPLEMENTER: <agent-id> ──► VALIDATOR: <agent-id>]
  const implementerId =
    task.implementerAgent ??
    (task.assignedRole !== "validator" ? task.assignedAgent : null);
  const validatorId =
    task.validatorAgent ??
    task.validatorId ??
    (task.assignedRole === "validator" ? task.assignedAgent : null);
  const subagentAlloc = formatSubagentAllocation(
    implementerId,
    validatorId,
    task.assignedRole ?? "IMPLEMENTER",
  );
  if (subagentAlloc) {
    rows.push(`Allocations: ${subagentAlloc}`);
  }

  // Coordinates rendering
  const coords = formatCoordinates(task.coordinates, task.wave, task.lane);
  if (coords) {
    rows.push(`Coordinates: ${coords}`);
  }

  // Phase / Work / Span / Dependencies
  if (task.dependencies.length === 0) {
    rows.push(`Role: ${role} | Work: ${work} | Span: ${span}`);
  } else {
    rows.push(`Role: ${role} | Needs: ${task.dependencies.join(", ")}`);
    rows.push(`Work: ${work} | Span: ${span}`);
  }

  // Probe / Repair Round Indicators
  if (task.probeRound !== undefined && task.probeRound > 0) {
    rows.push(`Probe Round: P${task.probeRound} (🔍 PROBING)`);
  }
  if (task.round !== undefined && task.round > 1) {
    rows.push(`Repair Round: R${task.round} (⟳ REPAIRING)`);
  }

  if (options.detailed || (task.writeScope && task.writeScope.length > 0)) {
    const scopes =
      task.writeScope && task.writeScope.length > 0 ? task.writeScope.join(", ") : "none";
    rows.push(`Scope: ${scopes}`);
  }

  if (task.dependencies.length > 0 && (options.detailed || task.depReasons)) {
    for (const depId of task.dependencies) {
      const reason = task.depReasons?.[depId];
      if (reason && reason.trim().length > 0) {
        rows.push(`↳ Dep on ${depId}: ${reason.trim()}`);
      }
    }
  }

  if (options.detailed && task.gate) {
    rows.push(`Gate:  ${task.gate}`);
  }

  // Dynamically expanded branch sub-tasks and live relationship arrows
  if (task.expandedSubtasks && task.expandedSubtasks.length > 0) {
    const branchHeader = task.branchId
      ? `↳ Dynamic Branch [${task.branchId}] (${task.expandedSubtasks.length} sub-tasks):`
      : `↳ Dynamic Sub-tasks (${task.expandedSubtasks.length}):`;
    rows.push(branchHeader);

    for (let i = 0; i < task.expandedSubtasks.length; i++) {
      const sub = task.expandedSubtasks[i]!;
      const isLast = i === task.expandedSubtasks.length - 1;
      const connector = isLast ? "  └──►" : "  ├──►";

      if (typeof sub === "string") {
        rows.push(`${connector} [${sub}]`);
      } else {
        const subId = sub.id;
        const subStatus = formatStatusBadge(sub.status ?? "ready");
        const subRole =
          "assignedRole" in sub && typeof sub.assignedRole === "string"
            ? sub.assignedRole
            : "role" in sub && typeof sub.role === "string"
              ? sub.role
              : undefined;
        const subImpl =
          "assignedAgent" in sub && subRole !== "validator"
            ? sub.assignedAgent
            : "implementerAgent" in sub && typeof sub.implementerAgent === "string"
              ? sub.implementerAgent
              : null;
        const subVal =
          "validatorId" in sub && typeof sub.validatorId === "string"
            ? sub.validatorId
            : "validatorAgent" in sub && typeof sub.validatorAgent === "string"
              ? sub.validatorAgent
              : "assignedAgent" in sub && subRole === "validator"
                ? sub.assignedAgent
                : null;
        const childAlloc = formatSubagentAllocation(subImpl, subVal, subRole ?? "IMPLEMENTER");
        const allocSuffix = childAlloc ? ` ${childAlloc}` : "";
        rows.push(`${connector} [${subId}] ${subStatus}${allocSuffix}`);
      }
    }
  }

  if (
    task.assignedAgent &&
    task.status !== "leased" &&
    task.status !== "running" &&
    task.status !== "validating" &&
    task.status !== "active"
  ) {
    const attemptStr =
      task.attempt !== null && task.attempt !== undefined ? ` (Attempt #${task.attempt})` : "";
    const toolStr = task.assignedTool ? ` • Tool: ${task.assignedTool}` : "";
    rows.push(`Agent: ${task.assignedAgent}${attemptStr}${toolStr}`);
  } else if (
    task.assignedTool &&
    (task.status === "leased" ||
      task.status === "running" ||
      task.status === "validating" ||
      task.status === "active")
  ) {
    rows.push(`Tool:  ${task.assignedTool}`);
  }

  const maxRowLen = Math.max(...rows.map((r) => r.length));
  const defaultWidth = options.boxWidth ?? 63;
  const targetWidth = Math.max(defaultWidth, maxRowLen + 4);
  const finalWidth = targetWidth % 2 === 0 ? targetWidth + 1 : targetWidth;
  const innerWidth = finalWidth - 4;

  const topBorder = `${cornerTL}${horiz.repeat(finalWidth - 2)}${cornerTR}`;
  const bottomBorder = `${cornerBL}${horiz.repeat(finalWidth - 2)}${cornerBR}`;

  const formattedRows = rows.map((row) => {
    const padding = Math.max(0, innerWidth - row.length);
    return `${vert} ${row}${" ".repeat(padding)} ${vert}`;
  });

  return [topBorder, ...formattedRows, bottomBorder];
}

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

  // 1. Assign ranks
  const rankMap = assignSugiyamaRanks(nodes, edges, cycleDiagnostic.cycleNodeIds);
  const maxRank = Math.max(0, ...[...rankMap.values()]);

  // Initial layer buckets
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

  // 2. Crossing minimization
  const optimizedLayers = minimizeCrossingsBarycenter(initialLayers, edges);
  const flatRankedNodes = optimizedLayers.flatMap((l) => l.nodes);

  // 3. Render graphical output
  const lines: string[] = [];

  // Prominent Cycle Alert
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

  // Prominent Illegal Bypass Warning
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
    const layer = optimizedLayers[lIdx]!;
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
      const task = waveTasks[tIdx]!;
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
        lines.push("                              │");
        lines.push("                        ──┬── ──▶ [PARALLEL LANE]");
        lines.push("                              │");
      }
    }

    if (!isLastWave) {
      lines.push("                              │");
      lines.push("                              ▼");
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
