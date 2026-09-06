import type { DagEdge, DagTaskNode, TarjanSccResult } from "./types.ts";

export function detectCyclesTarjan(tasks: readonly DagTaskNode[]): TarjanSccResult {
  const nodeMap = new Map<string, DagTaskNode>();
  for (const t of tasks) {
    nodeMap.set(t.id, t);
  }

  const allNodeIds = Array.from(nodeMap.keys()).sort();
  const adj = new Map<string, string[]>();

  for (const node of allNodeIds) {
    const t = nodeMap.get(node);
    const validDeps = (t?.dependencies ?? []).filter((dep) => nodeMap.has(dep));
    adj.set(node, [...validDeps]);
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
        sccs.push(scc.reverse());
      } else if (scc.length === 1 && scc[0] !== undefined) {
        const single = scc[0];
        if ((adj.get(single) ?? []).includes(single)) {
          sccs.push(scc);
        }
      }
    }
  }

  for (const node of allNodeIds) {
    if (!indices.has(node)) {
      strongConnect(node);
    }
  }

  const cycles: string[][] = [];
  const feedbackArcs: DagEdge[] = [];
  const feedbackArcSet = new Set<string>();

  for (const scc of sccs) {
    if (scc.length === 1 && scc[0] !== undefined) {
      const single = scc[0];
      const key = `${single}->${single}`;
      if (!feedbackArcSet.has(key)) {
        feedbackArcSet.add(key);
        feedbackArcs.push({ from: single, to: single });
        cycles.push([single, single]);
      }
      continue;
    }

    const sccSet = new Set(scc);
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const dfsStack: string[] = [];

    function dfs(u: string): void {
      visited.add(u);
      visiting.add(u);
      dfsStack.push(u);

      const targets = adj.get(u) ?? [];
      for (const v of targets) {
        if (!sccSet.has(v)) continue;
        if (visiting.has(v)) {
          const key = `${u}->${v}`;
          if (!feedbackArcSet.has(key)) {
            feedbackArcSet.add(key);
            feedbackArcs.push({ from: u, to: v });
          }
          const vIdx = dfsStack.indexOf(v);
          if (vIdx >= 0) {
            const detectedCycle = [...dfsStack.slice(vIdx), v];
            cycles.push(detectedCycle);
          }
        } else if (!visited.has(v)) {
          dfs(v);
        }
      }

      dfsStack.pop();
      visiting.delete(u);
    }

    for (const node of scc) {
      if (!visited.has(node)) {
        dfs(node);
      }
    }
  }

  return {
    acyclic: sccs.length === 0,
    sccs,
    cycles,
    feedbackArcs,
  };
}
