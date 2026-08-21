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

function describeCycle(
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
  order: readonly string[],
): string {
  const resolved = new Set(order);
  const unresolved = new Set([...dependencies.keys()].filter((id) => !resolved.has(id)));
  const start = [...unresolved].sort()[0]!;
  const path = [start];
  const positionOf = new Map([[start, 0]]);
  let current = start;
  for (;;) {
    const next = [...(dependencies.get(current) ?? [])]
      .filter((id) => unresolved.has(id))
      .sort()[0]!;
    const seenAt = positionOf.get(next);
    if (seenAt !== undefined) {
      const cycle = path.slice(seenAt);
      const cycleEdges = cycle.map(
        (id, index) => `${id} --deps ${cycle[(index + 1) % cycle.length]}`,
      );
      return `${joinWithAnd(cycleEdges)} form a cycle; drop ${cycleEdges[0]} to break it`;
    }
    positionOf.set(next, path.length);
    path.push(next);
    current = next;
  }
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
