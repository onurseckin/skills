export function validateRoles(
  edges: readonly Record<string, unknown>[],
  nodes: ReadonlyMap<string, Record<string, unknown>>,
  issues: string[],
): void {
  const assigned = new Map<string, Set<string>>();
  const validators = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.type === "assigned_to") {
      const task = typeof edge.source === "string" ? nodes.get(edge.source) : undefined;
      const agent = typeof edge.target === "string" ? nodes.get(edge.target) : undefined;
      if (task?.type !== "task" || agent?.type !== "agent") {
        issues.push("assigned_to edges must connect a task to an agent");
        continue;
      }
      if (agent.role === "validator")
        issues.push(`validator ${String(edge.target)} cannot implement`);
      const ids = assigned.get(edge.source as string) ?? new Set<string>();
      ids.add(edge.target as string);
      assigned.set(edge.source as string, ids);
    }
    if (edge.type === "validates") {
      const agent = typeof edge.source === "string" ? nodes.get(edge.source) : undefined;
      const task = typeof edge.target === "string" ? nodes.get(edge.target) : undefined;
      if (agent?.type !== "agent" || task?.type !== "task") {
        issues.push("validates edges must connect an agent to a task");
        continue;
      }
      if (agent.role !== "validator")
        issues.push(`validating agent ${String(edge.source)} needs validator role`);
      const ids = validators.get(edge.target as string) ?? new Set<string>();
      ids.add(edge.source as string);
      validators.set(edge.target as string, ids);
    }
  }
  for (const [task, implementers] of assigned) {
    for (const validator of validators.get(task) ?? []) {
      if (implementers.has(validator))
        issues.push(`task ${task} cannot use the same implementer and validator`);
    }
  }
}
