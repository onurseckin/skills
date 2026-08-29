import type { RunState, TaskRecord } from "../../core/contracts/index.ts";
import { scopeConflict, resourceConflict, hasActiveOwnership } from "./conflict/conflicts.ts";

export function proposeBatch(
  state: unknown,
  maxParallel = 8,
): readonly TaskRecord[] {
  if (!state || typeof state !== "object") return [];
  const s = state as RunState;
  if (!s.tasks || typeof s.tasks !== "object") return [];

  const allTasks = Object.values(s.tasks) as TaskRecord[];
  const activeTasks = allTasks.filter((t) => hasActiveOwnership(t.status));
  const candidateTasks = allTasks.filter((t) => t.status === "ready" || t.status === "proposed");

  const sorted = [...candidateTasks].sort((a, b) => {
    if ((b.priority ?? 0) !== (a.priority ?? 0)) {
      return (b.priority ?? 0) - (a.priority ?? 0);
    }
    return a.id.localeCompare(b.id);
  });

  const batch: TaskRecord[] = [];
  const selectedWriteScopes: string[][] = activeTasks.map((t) => [...t.write_scope]);
  const selectedResourceScopes: string[][] = activeTasks.map((t) => [...(t.resource_scope ?? [])]);

  for (const task of sorted) {
    if (batch.length >= maxParallel) break;

    if (Array.isArray(task.dependencies) && task.dependencies.length > 0) {
      const allDepsMet = task.dependencies.every((depId) => {
        const dep = s.tasks[depId];
        return dep && dep.status === "done";
      });
      if (!allDepsMet) continue;
    }

    const taskWrite = task.write_scope || [];
    const taskResource = task.resource_scope || [];

    const hasScopeConflict = selectedWriteScopes.some((ws) => scopeConflict(ws, taskWrite));
    if (hasScopeConflict) continue;

    const hasResourceConflict = selectedResourceScopes.some((rs) => resourceConflict(rs, taskResource));
    if (hasResourceConflict) continue;

    batch.push(task);
    selectedWriteScopes.push([...taskWrite]);
    selectedResourceScopes.push([...taskResource]);
  }

  return batch;
}
