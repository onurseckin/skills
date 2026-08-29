import type {
  BypassDiagnostic,
  BypassDiagnosticItem,
  CycleDiagnostic,
  DiagnosticHealthResult,
  SugiyamaEdge,
  SugiyamaNode,
} from "./types.ts";

function computeTarjanSccs(
  nodes: readonly SugiyamaNode[],
  edges: readonly SugiyamaEdge[],
): { adj: Map<string, string[]>; sccs: string[][] } {
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    if (adj.has(e.from)) adj.get(e.from)?.push(e.to);
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

    for (const w of adj.get(v) ?? []) {
      if (!indices.has(w)) {
        strongConnect(w);
        lowlinks.set(v, Math.min(lowlinks.get(v) ?? 0, lowlinks.get(w) ?? 0));
      } else if (onStack.get(w)) {
        lowlinks.set(v, Math.min(lowlinks.get(v) ?? 0, indices.get(w) ?? 0));
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
      } else if (scc.length === 1 && scc[0] !== undefined && adj.get(scc[0])?.includes(scc[0])) {
        sccs.push(scc);
      }
    }
  }

  for (const n of nodes) {
    if (!indices.has(n.id)) strongConnect(n.id);
  }
  return { adj, sccs };
}

export function extractFeedbackArcSet(
  nodes: readonly SugiyamaNode[],
  edges: readonly SugiyamaEdge[],
): { feedbackArcs: { from: string; to: string }[]; acyclicEdges: SugiyamaEdge[] } {
  const { adj, sccs } = computeTarjanSccs(nodes, edges);
  if (sccs.length === 0) return { feedbackArcs: [], acyclicEdges: [...edges] };

  const feedbackArcs: { from: string; to: string }[] = [];
  const feedbackArcSet = new Set<string>();

  for (const scc of sccs) {
    if (scc.length === 1 && scc[0] !== undefined) {
      const single = scc[0];
      const key = `${single}->${single}`;
      if (!feedbackArcSet.has(key)) {
        feedbackArcSet.add(key);
        feedbackArcs.push({ from: single, to: single });
      }
      continue;
    }

    const sccSet = new Set(scc);
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const depth = new Map<string, number>();

    function dfs(u: string, d: number): void {
      visited.add(u);
      visiting.add(u);
      depth.set(u, d);

      for (const v of adj.get(u) ?? []) {
        if (!sccSet.has(v)) continue;
        if (visiting.has(v)) {
          const key = `${u}->${v}`;
          if (!feedbackArcSet.has(key)) {
            feedbackArcSet.add(key);
            feedbackArcs.push({ from: u, to: v });
          }
        } else if (!visited.has(v)) {
          dfs(v, d + 1);
        }
      }
      visiting.delete(u);
    }

    for (const node of nodes) {
      if (sccSet.has(node.id) && !visited.has(node.id)) {
        dfs(node.id, 0);
      }
    }
  }

  const acyclicEdges = edges.filter((e) => !feedbackArcSet.has(`${e.from}->${e.to}`));
  return { feedbackArcs, acyclicEdges };
}

export function reverseCycleEdges(
  edges: readonly SugiyamaEdge[],
  feedbackArcs: readonly { readonly from: string; readonly to: string }[],
): SugiyamaEdge[] {
  const faSet = new Set(feedbackArcs.map((fa) => `${fa.from}->${fa.to}`));
  return edges.map((e) => (faSet.has(`${e.from}->${e.to}`) ? { ...e, from: e.to, to: e.from } : e));
}

export function detectCyclesTarjan(
  nodes: readonly SugiyamaNode[],
  edges: readonly SugiyamaEdge[],
): CycleDiagnostic {
  const { adj, sccs } = computeTarjanSccs(nodes, edges);
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
    for (const id of scc) cycleNodeSet.add(id);

    if (scc.length === 1 && scc[0] !== undefined) {
      const single = scc[0];
      cyclePaths.push([single, single]);
      cycleEdges.push({ from: single, to: single });
      remediation.push(`Drop self-dependency on task ${single}`);
      continue;
    }

    const sccSet = new Set(scc);
    const start = nodes.find((n) => sccSet.has(n.id))?.id ?? scc[0];
    if (!start) continue;

    const path: string[] = [start];
    const visitedInPath = new Set<string>([start]);
    let curr = start;
    let foundCycle = false;

    for (let step = 0; step < scc.length + 5 && !foundCycle; step++) {
      const nextCandidates = (adj.get(curr) ?? []).filter((nextId) => sccSet.has(nextId));
      if (nextCandidates.length === 0) break;
      const next = nextCandidates[0];
      if (!next) break;

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
      const fromNode = path[i];
      const toNode = path[i + 1];
      if (fromNode && toNode) cycleEdges.push({ from: fromNode, to: toNode });
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

export function detectIllegalBypasses(
  nodes: readonly SugiyamaNode[],
  edges: readonly SugiyamaEdge[],
): BypassDiagnostic {
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    if (adj.has(e.from)) adj.get(e.from)?.push(e.to);
  }

  function findAllPaths(start: string, target: string, maxDepth = 6): string[][] {
    const paths: string[][] = [];
    function dfs(curr: string, currentPath: string[]): void {
      if (currentPath.length > maxDepth) return;
      if (curr === target) {
        if (currentPath.length > 2) paths.push([...currentPath]);
        return;
      }
      for (const next of adj.get(curr) ?? []) {
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
    for (const p of findAllPaths(e.from, e.to)) {
      const intermediate = p.slice(1, -1);
      const reason = `Direct edge [${e.from} ➔ ${e.to}] bypasses required intermediate stage (${intermediate.join(" ➔ ")})`;
      bypassItems.push({ from: e.from, to: e.to, intermediatePath: intermediate, reason });
      warnings.push(`❌ [ILLEGAL BYPASS]: ${reason}`);
    }
  }

  return {
    hasBypass: bypassItems.length > 0,
    bypasses: bypassItems,
    alert: bypassItems.length > 0 ? "❌ [ILLEGAL BYPASS]" : "",
    warnings,
  };
}

export function validateDiagnosticHealth(
  nodes: readonly SugiyamaNode[],
  edges: readonly SugiyamaEdge[],
): DiagnosticHealthResult {
  const cycleDiag = detectCyclesTarjan(nodes, edges);
  const bypassDiag = detectIllegalBypasses(nodes, edges);
  const issues: string[] = [];
  if (cycleDiag.hasCycle) {
    issues.push(`Cycle detected: ${cycleDiag.cyclePaths.map((p) => p.join(" -> ")).join(", ")}`);
  }
  for (const b of bypassDiag.bypasses) {
    issues.push(
      `Illegal bypass: ${b.from} -> ${b.to} via intermediate [${b.intermediatePath.join(", ")}]`,
    );
  }
  return {
    healthy: !cycleDiag.hasCycle && !bypassDiag.hasBypass,
    issues,
    cycleCount: cycleDiag.cyclePaths.length,
    bypassCount: bypassDiag.bypasses.length,
  };
}
