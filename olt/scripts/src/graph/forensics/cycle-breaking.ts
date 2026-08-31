import { topologicalOrder } from "../topology.ts";
import { extractNeighbors } from "./critical-path.ts";
import type { CycleBreakCandidate } from "./types.ts";

export function isAcyclic(dependencies: ReadonlyMap<string, ReadonlySet<string>>): boolean {
  const order = topologicalOrder(dependencies);
  return order.length === dependencies.size;
}

export function findCycles(dependencies: ReadonlyMap<string, ReadonlySet<string>>): string[][] {
  const allNodes = Array.from(dependencies.keys()).sort();
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];

  function dfs(node: string): void {
    visited.add(node);
    inStack.add(node);
    stack.push(node);

    const neighbors = extractNeighbors(dependencies, node);
    for (const neighbor of neighbors) {
      if (!dependencies.has(neighbor)) continue;

      if (inStack.has(neighbor)) {
        const cycleStartIndex = stack.indexOf(neighbor);
        if (cycleStartIndex >= 0) {
          const cycle = stack.slice(cycleStartIndex);
          cycles.push(cycle);
        }
      } else if (!visited.has(neighbor)) {
        dfs(neighbor);
      }
    }

    stack.pop();
    inStack.delete(node);
  }

  for (const node of allNodes) {
    if (!visited.has(node)) {
      dfs(node);
    }
  }

  return cycles;
}

function computeTarjanSccs(
  allNodes: readonly string[],
  adj: ReadonlyMap<string, readonly string[]>,
): string[][] {
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
      } else if (
        scc.length === 1 &&
        scc[0] !== undefined &&
        (adj.get(scc[0]) ?? []).includes(scc[0])
      ) {
        sccs.push(scc);
      }
    }
  }

  for (const node of allNodes) {
    if (!indices.has(node)) strongConnect(node);
  }
  return sccs;
}

export function extractFeedbackArcsTarjan(dependencies: ReadonlyMap<string, ReadonlySet<string>>): {
  feedbackArcs: { from: string; to: string }[];
  sccs: string[][];
} {
  const allNodes = Array.from(dependencies.keys()).sort();
  const adj = new Map<string, string[]>();
  for (const node of allNodes) {
    adj.set(
      node,
      Array.from(dependencies.get(node) ?? []).filter((p) => dependencies.has(p)),
    );
  }

  const sccs = computeTarjanSccs(allNodes, adj);
  const feedbackArcs: { from: string; to: string }[] = [];
  const faSet = new Set<string>();

  for (const scc of sccs) {
    if (scc.length === 1 && scc[0] !== undefined) {
      const single = scc[0];
      const key = `${single}->${single}`;
      if (!faSet.has(key)) {
        faSet.add(key);
        feedbackArcs.push({ from: single, to: single });
      }
      continue;
    }

    const sccSet = new Set(scc);
    const visited = new Set<string>();
    const visiting = new Set<string>();

    function dfs(u: string): void {
      visited.add(u);
      visiting.add(u);

      for (const v of adj.get(u) ?? []) {
        if (!sccSet.has(v)) continue;
        if (visiting.has(v)) {
          const key = `${u}->${v}`;
          if (!faSet.has(key)) {
            faSet.add(key);
            feedbackArcs.push({ from: u, to: v });
          }
        } else if (!visited.has(v)) {
          dfs(v);
        }
      }
      visiting.delete(u);
    }

    for (const node of scc) {
      if (!visited.has(node)) {
        dfs(node);
      }
    }
  }

  return { feedbackArcs, sccs };
}

export function breakCycles(dependencies: ReadonlyMap<string, ReadonlySet<string>>): {
  readonly acyclicDependencies: Map<string, Set<string>>;
  readonly remainingDag: Map<string, Set<string>>;
  readonly brokenEdges: readonly CycleBreakCandidate[];
} {
  const mutDeps = new Map<string, Set<string>>();
  for (const [k, v] of dependencies) {
    mutDeps.set(k, new Set(v));
  }

  const brokenEdges: CycleBreakCandidate[] = [];
  const { feedbackArcs, sccs } = extractFeedbackArcsTarjan(mutDeps);

  for (const { from, to } of feedbackArcs) {
    const set = mutDeps.get(from);
    if (set !== undefined && set.has(to)) {
      set.delete(to);
      const matchedScc = sccs.find((s) => s.includes(from) && s.includes(to)) ?? [from, to];
      brokenEdges.push({
        fromTaskId: from,
        toTaskId: to,
        edgeDescription: `${from} --deps ${to}`,
        rationale: `Tarjan SCC FAS cycle-breaking: dropped feedback back-edge ${from} -> ${to} to preserve forward critical path`,
        cycle: matchedScc,
      });
    }
  }

  return {
    acyclicDependencies: mutDeps,
    remainingDag: mutDeps,
    brokenEdges,
  };
}
