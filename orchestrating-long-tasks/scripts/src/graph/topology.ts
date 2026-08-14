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
      issues.push("depends_on edges must connect two tasks");
    } else if (source === target) issues.push(`task ${source} cannot depend on itself`);
    else dependencies.get(source)!.add(target);
  }
  if (topologicalOrder(dependencies).length !== dependencies.size) {
    issues.push("depends_on edges contain an execution cycle");
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
