import { HarnessError } from "../../core/errors/index.ts";
import type { AcyclicityValidationResult } from "./types.ts";

function findCyclePath(
  unresolvedIds: readonly string[],
  tasks: readonly { readonly id: string; readonly dependencies?: readonly string[] | undefined }[],
): string[] {
  const unresolvedSet = new Set(unresolvedIds);
  const taskMap = new Map<string, readonly string[]>();
  for (const t of tasks) {
    if (unresolvedSet.has(t.id)) {
      const taskDeps = t.dependencies !== undefined ? t.dependencies : [];
      taskMap.set(
        t.id,
        taskDeps.filter((d) => unresolvedSet.has(d)),
      );
    }
  }

  const visited = new Set<string>();
  const recStack = new Set<string>();
  const path: string[] = [];

  function dfs(node: string): string[] | null {
    visited.add(node);
    recStack.add(node);
    path.push(node);

    const rawDeps = taskMap.get(node);
    const deps = rawDeps !== undefined ? rawDeps : [];
    for (const dep of deps) {
      if (!visited.has(dep)) {
        const found = dfs(dep);
        if (found) return found;
      } else if (recStack.has(dep)) {
        const cycleStartIdx = path.indexOf(dep);
        return [...path.slice(cycleStartIdx), dep];
      }
    }

    recStack.delete(node);
    path.pop();
    return null;
  }

  for (const start of unresolvedIds) {
    if (!visited.has(start)) {
      const cycle = dfs(start);
      if (cycle) return cycle;
    }
  }

  return [];
}

export function validateTopologyAcyclicity(
  tasks: readonly { readonly id: string; readonly dependencies?: readonly string[] | undefined }[],
  options?: { readonly strict?: boolean | undefined },
): AcyclicityValidationResult {
  const strict =
    options !== undefined && typeof options.strict === "boolean" ? options.strict : false;
  const issues: string[] = [];

  const taskIds = new Set<string>();
  for (const t of tasks) {
    const id = t.id.trim();
    if (!id) {
      const msg = "Task ID must be a non-empty string";
      if (strict) throw new HarnessError("INVALID_ARGUMENT", msg);
      issues.push(msg);
      return { isAcyclic: false, topologicalOrder: [], issues };
    }
    if (taskIds.has(id)) {
      const msg = `Duplicate task ID detected: ${id}`;
      if (strict) throw new HarnessError("INVALID_ARGUMENT", msg);
      issues.push(msg);
      return { isAcyclic: false, topologicalOrder: [], issues };
    }
    taskIds.add(id);
  }

  const adjacency = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();

  for (const id of taskIds) {
    adjacency.set(id, new Set());
    inDegree.set(id, 0);
  }

  for (const t of tasks) {
    const dependentId = t.id.trim();
    const deps = t.dependencies !== undefined ? t.dependencies : [];
    for (const rawPrereq of deps) {
      const prereq = rawPrereq.trim();
      if (!prereq) continue;

      if (!taskIds.has(prereq)) {
        const msg = `Task '${dependentId}' references unknown dependency '${prereq}'`;
        if (strict) throw new HarnessError("INVALID_ARGUMENT", msg);
        issues.push(msg);
        continue;
      }

      if (prereq === dependentId) {
        const msg = `Self-referential dependency: task '${dependentId}' cannot depend on itself`;
        if (strict) throw new HarnessError("INVALID_ARGUMENT", msg);
        issues.push(msg);
        return {
          isAcyclic: false,
          topologicalOrder: [],
          cycle: [dependentId, dependentId],
          issues,
        };
      }

      const currentDeps = adjacency.get(prereq);
      if (currentDeps && !currentDeps.has(dependentId)) {
        currentDeps.add(dependentId);
        const currentDeg = inDegree.get(dependentId);
        inDegree.set(dependentId, (currentDeg !== undefined ? currentDeg : 0) + 1);
      }
    }
  }

  const ready: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) {
      ready.push(id);
    }
  }
  ready.sort();

  const topologicalOrder: string[] = [];
  while (ready.length > 0) {
    const current = ready.shift()!;
    topologicalOrder.push(current);

    const neighbors = adjacency.get(current);
    if (neighbors) {
      for (const neighbor of neighbors) {
        const currentNeighborDeg = inDegree.get(neighbor);
        const remaining = (currentNeighborDeg !== undefined ? currentNeighborDeg : 1) - 1;
        inDegree.set(neighbor, remaining);
        if (remaining === 0) {
          const pos = ready.findIndex((id) => id > neighbor);
          if (pos < 0) {
            ready.push(neighbor);
          } else {
            ready.splice(pos, 0, neighbor);
          }
        }
      }
    }
  }

  if (topologicalOrder.length !== taskIds.size) {
    const remainingTasks = Array.from(taskIds).filter((id) => !topologicalOrder.includes(id));
    const cycle = findCyclePath(remainingTasks, tasks);
    const cycleDesc = cycle.length > 0 ? cycle.join(" -> ") : remainingTasks.join(", ");
    const msg = `Cycle detected in task dependencies involving: ${cycleDesc}`;

    if (strict) {
      throw new HarnessError("INVALID_ARGUMENT", msg);
    }

    issues.push(msg);
    return {
      isAcyclic: false,
      topologicalOrder: [],
      cycle: cycle.length > 0 ? cycle : remainingTasks,
      issues,
    };
  }

  return {
    isAcyclic: true,
    topologicalOrder,
    issues,
  };
}
