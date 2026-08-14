import { downstreamMap, topologicalOrder, type DependencyMap } from "../graph/topology.ts";
import { HarnessError } from "../errors/harness-error.ts";

export interface SchedulingMetrics {
  criticalDepth: Map<string, number>;
  descendants: Map<string, number>;
}

export function schedulingMetrics(dependencies: DependencyMap): SchedulingMetrics {
  const downstream = downstreamMap(dependencies);
  const order = topologicalOrder(dependencies);
  if (order.length !== dependencies.size) {
    throw new HarnessError("INTEGRITY", "depends_on edges contain an execution cycle");
  }
  const criticalDepth = new Map([...dependencies.keys()].map((id) => [id, 0]));
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const id = order[index]!;
    let depth = 0;
    for (const child of downstream.get(id) ?? []) {
      depth = Math.max(depth, 1 + (criticalDepth.get(child) ?? 0));
    }
    criticalDepth.set(id, depth);
  }
  const descendants = new Map<string, number>();
  for (const id of dependencies.keys()) {
    const visited = new Set<string>();
    const pending = [...(downstream.get(id) ?? [])];
    while (pending.length) {
      const descendant = pending.pop()!;
      if (visited.has(descendant)) continue;
      visited.add(descendant);
      for (const child of downstream.get(descendant) ?? []) {
        if (!visited.has(child)) pending.push(child);
      }
    }
    descendants.set(id, visited.size);
  }
  return { criticalDepth, descendants };
}
