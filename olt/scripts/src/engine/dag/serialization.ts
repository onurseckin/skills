import type { ArtificialSerializationEdge, DagTaskNode } from "./types.ts";

function normalizeScope(scope: string): string {
  return scope.trim().replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

function scopesOverlap(scopeA: string, scopeB: string): boolean {
  const normA = normalizeScope(scopeA);
  const normB = normalizeScope(scopeB);
  return normA === normB || normA.startsWith(`${normB}/`) || normB.startsWith(`${normA}/`);
}

function hasScopeOverlap(scopesA: readonly string[], scopesB: readonly string[]): boolean {
  for (const sA of scopesA) {
    for (const sB of scopesB) {
      if (scopesOverlap(sA, sB)) return true;
    }
  }
  return false;
}

export function detectArtificialSerializationEdges(
  tasks: readonly DagTaskNode[],
): readonly ArtificialSerializationEdge[] {
  const taskMap = new Map<string, DagTaskNode>();
  for (const t of tasks) {
    taskMap.set(t.id, t);
  }

  const artificialEdges: ArtificialSerializationEdge[] = [];

  for (const task of tasks) {
    const scopesTarget = task.writeScope ?? [];
    for (const depId of task.dependencies) {
      const depTask = taskMap.get(depId);
      if (!depTask) continue;

      const scopesDep = depTask.writeScope ?? [];

      if (scopesTarget.length > 0 && scopesDep.length > 0) {
        const overlaps = hasScopeOverlap(scopesTarget, scopesDep);
        if (!overlaps) {
          artificialEdges.push({
            fromTaskId: depId,
            toTaskId: task.id,
            reason: `Edge ${depId} -> ${task.id} serializes tasks with mutually disjoint write scopes ([${scopesDep.join(", ")}] vs [${scopesTarget.join(", ")}])`,
            canDecouple: true,
          });
        }
      }
    }
  }

  return artificialEdges;
}
