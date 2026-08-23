export type DependencyMap = Map<string, Set<string>>;

export function topologicalOrder(dependencies: ReadonlyMap<string, ReadonlySet<string>>): string[] {
  const downstream = new Map<string, Set<string>>();
  const remaining = new Map<string, number>();
  for (const [id, prerequisites] of dependencies) {
    downstream.set(id, new Set());
    remaining.set(id, prerequisites.size);
  }
  for (const [dependent, prerequisites] of dependencies) {
    for (const prerequisite of prerequisites) downstream.get(prerequisite)?.add(dependent);
  }
  const ready = [...remaining]
    .filter(([, count]) => count === 0)
    .map(([id]) => id)
    .sort();
  const order: string[] = [];
  while (ready.length) {
    const prerequisite = ready.shift()!;
    order.push(prerequisite);
    for (const dependent of [...(downstream.get(prerequisite) ?? [])].sort()) {
      const next = remaining.get(dependent)! - 1;
      remaining.set(dependent, next);
      if (next === 0) {
        const position = ready.findIndex((id) => id > dependent);
        ready.splice(position < 0 ? ready.length : position, 0, dependent);
      }
    }
  }
  return order;
}

function describeEndpoint(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "<missing>";
  const serialized = JSON.stringify(value);
  if (serialized !== undefined) return serialized;
  return `<unserializable ${typeof value}>`;
}

function joinWithAnd(items: readonly string[]): string {
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

export function describeCycle(
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
  order?: readonly string[],
): string {
  const resolved = new Set(order ?? topologicalOrder(dependencies));
  const unresolved = new Set([...dependencies.keys()].filter((id) => !resolved.has(id)));
  if (unresolved.size === 0) return "no cycle detected";

  for (const start of [...unresolved].sort()) {
    const stack: { node: string; edgeIdx: number; neighbors: string[] }[] = [];
    const inStack = new Set<string>();
    const visited = new Set<string>();

    const startNeighbors = [...(dependencies.get(start) ?? [])]
      .filter((id) => unresolved.has(id))
      .sort();
    stack.push({ node: start, edgeIdx: 0, neighbors: startNeighbors });
    inStack.add(start);
    visited.add(start);

    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      if (top.edgeIdx < top.neighbors.length) {
        const next = top.neighbors[top.edgeIdx]!;
        top.edgeIdx++;

        if (inStack.has(next)) {
          const cycleNodes: string[] = [];
          const idx = stack.findIndex((item) => item.node === next);
          for (let i = idx; i < stack.length; i++) {
            cycleNodes.push(stack[i]!.node);
          }
          const cycleEdges = cycleNodes.map(
            (id, i) => `${id} --deps ${cycleNodes[(i + 1) % cycleNodes.length]}`,
          );
          return `${joinWithAnd(cycleEdges)} form a cycle; drop ${cycleEdges[0]} to break it`;
        } else if (!visited.has(next)) {
          visited.add(next);
          inStack.add(next);
          const nextNeighbors = [...(dependencies.get(next) ?? [])]
            .filter((id) => unresolved.has(id))
            .sort();
          stack.push({ node: next, edgeIdx: 0, neighbors: nextNeighbors });
        }
      } else {
        inStack.delete(top.node);
        stack.pop();
      }
    }
  }

  return "cycle detected";
}

export function dependencyData(
  nodes: readonly Record<string, unknown>[],
  edges: readonly Record<string, unknown>[],
): { dependencies: DependencyMap; issues: string[] } {
  const taskIds = new Set(
    nodes
      .filter(({ type, id }) => type === "task" && typeof id === "string")
      .map(({ id }) => id as string),
  );
  const dependencies: DependencyMap = new Map([...taskIds].map((id) => [id, new Set()]));
  const issues: string[] = [];
  for (const edge of edges) {
    if (edge.type !== "depends_on") continue;
    const { source, target } = edge;
    if (
      typeof source !== "string" ||
      typeof target !== "string" ||
      !taskIds.has(source) ||
      !taskIds.has(target)
    ) {
      issues.push(
        `depends_on edge ${describeEndpoint(source)} --deps ${describeEndpoint(target)} must connect two tasks`,
      );
    } else if (source === target) {
      issues.push(`task ${source} cannot depend on itself; drop ${source} --deps ${target}`);
    } else dependencies.get(source)!.add(target);
  }
  const order = topologicalOrder(dependencies);
  if (order.length !== dependencies.size) {
    issues.push(describeCycle(dependencies, order));
  }
  return { dependencies, issues };
}

export function downstreamMap(
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
): DependencyMap {
  const downstream: DependencyMap = new Map([...dependencies.keys()].map((id) => [id, new Set()]));
  for (const [dependent, prerequisites] of dependencies) {
    for (const prerequisite of prerequisites) downstream.get(prerequisite)?.add(dependent);
  }
  return downstream;
}

export {
  ARTIFICIAL_SERIALIZATION_WARNING,
  type ArtificialSerializationWarning,
  type DecoupledGraphResult,
  type DecoupleOptions,
  type ParallelLaneAssignment,
  type ParallelMetrics,
  allocateParallelLanes,
  computeWorkSpanMetrics,
  decoupleDisjointTasks,
  detectArtificialSerialization,
} from "./parallel-decoupler.ts";

export {
  type BrentsBoundResult,
  type CycleBreakCandidate,
  type ForensicTaskNode,
  type ForensicWave,
  type TaskSlack,
  type WorkSpanMetrics,
  breakCycles,
  calculateBrentsTheorem,
  computeTaskSlack,
  computeTopologicalWaves,
  computeWorkSpan,
  findCycles,
  isAcyclic,
  renderMermaidDag,
} from "./dag-forensics.ts";
