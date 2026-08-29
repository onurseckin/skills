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
  let safetyCounter = 0;
  const maxIterations = dependencies.size * 2 + 10;

  while (!isAcyclic(mutDeps) && safetyCounter < maxIterations) {
    safetyCounter += 1;
    const cycles = findCycles(mutDeps);
    if (cycles.length === 0) {
      const order = topologicalOrder(mutDeps);
      const unresolved = Array.from(mutDeps.keys())
        .filter((id) => !order.includes(id))
        .sort();
      if (unresolved.length === 0) break;

      const firstUnresolved = unresolved[0];
      if (firstUnresolved !== undefined) {
        const prereqs = extractNeighbors(mutDeps, firstUnresolved);
        if (prereqs.length > 0) {
          const dropPrereq = prereqs[0];
          if (dropPrereq !== undefined) {
            const targetSet = mutDeps.get(firstUnresolved);
            if (targetSet !== undefined) {
              targetSet.delete(dropPrereq);
            }
            brokenEdges.push({
              fromTaskId: firstUnresolved,
              toTaskId: dropPrereq,
              edgeDescription: `${firstUnresolved} --deps ${dropPrereq}`,
              rationale: `Cycle-breaking heuristic: dropped feedback edge ${firstUnresolved} -> ${dropPrereq}`,
              cycle: [firstUnresolved, dropPrereq],
            });
          }
        }
      }
      continue;
    }

    const cycle = cycles[0];
    if (cycle === undefined) break;
    if (cycle.length === 0) break;

    const fromTaskId = cycle[0];
    let toTaskId = cycle[0];
    if (cycle.length > 1) {
      const second = cycle[1];
      if (second !== undefined) {
        toTaskId = second;
      }
    }

    if (fromTaskId !== undefined && toTaskId !== undefined) {
      const set = mutDeps.get(fromTaskId);
      if (set !== undefined) {
        set.delete(toTaskId);
      }
      const firstCycleNode = cycle[0];
      const loopBack = firstCycleNode !== undefined ? firstCycleNode : fromTaskId;
      brokenEdges.push({
        fromTaskId,
        toTaskId,
        edgeDescription: `${fromTaskId} --deps ${toTaskId}`,
        rationale: `Broke cycle [${cycle.join(" -> ")} -> ${loopBack}] by dropping edge ${fromTaskId} -> ${toTaskId}`,
        cycle,
      });
    }
  }

  return {
    acyclicDependencies: mutDeps,
    remainingDag: mutDeps,
    brokenEdges,
  };
}
