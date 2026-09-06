import type { DagTaskNode, ScopeOverlapFinding } from "./types.ts";

function normalizeScopePath(path: string): string {
  return path.trim().replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

function scopesConflict(scopeA: string, scopeB: string): boolean {
  const normA = normalizeScopePath(scopeA);
  const normB = normalizeScopePath(scopeB);

  if (normA === normB) {
    return true;
  }
  if (normA.startsWith(`${normB}/`)) {
    return true;
  }
  if (normB.startsWith(`${normA}/`)) {
    return true;
  }
  return false;
}

function computeReachability(tasks: readonly DagTaskNode[]): Map<string, Set<string>> {
  const taskMap = new Map<string, DagTaskNode>();
  for (const t of tasks) {
    taskMap.set(t.id, t);
  }

  const reachable = new Map<string, Set<string>>();
  for (const t of tasks) {
    reachable.set(t.id, new Set<string>());
  }

  for (const t of tasks) {
    const queue = [...t.dependencies];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (!visited.has(current) && taskMap.has(current)) {
        visited.add(current);
        reachable.get(t.id)?.add(current);
        const parent = taskMap.get(current);
        if (parent) {
          queue.push(...parent.dependencies);
        }
      }
    }
  }

  return reachable;
}

export function auditScopeOverlaps(tasks: readonly DagTaskNode[]): readonly ScopeOverlapFinding[] {
  const findings: ScopeOverlapFinding[] = [];
  const reachable = computeReachability(tasks);

  for (let i = 0; i < tasks.length; i++) {
    const taskA = tasks[i]!;
    const scopesA = taskA.writeScope ?? [];
    if (scopesA.length === 0) continue;

    for (let j = i + 1; j < tasks.length; j++) {
      const taskB = tasks[j]!;
      const scopesB = taskB.writeScope ?? [];
      if (scopesB.length === 0) continue;

      const isDependent =
        reachable.get(taskA.id)?.has(taskB.id) || reachable.get(taskB.id)?.has(taskA.id);

      if (isDependent) {
        continue;
      }

      for (const scopeA of scopesA) {
        for (const scopeB of scopesB) {
          if (scopesConflict(scopeA, scopeB)) {
            findings.push({
              taskA: taskA.id,
              taskB: taskB.id,
              scopeA,
              scopeB,
              overlapPath:
                normalizeScopePath(scopeA).length <= normalizeScopePath(scopeB).length
                  ? scopeA
                  : scopeB,
            });
          }
        }
      }
    }
  }

  return findings;
}
