import type { JsonObject } from "../contracts/json.ts";
import { proposeBatch } from "../scheduler/propose-batch.ts";
import { transact } from "../store/index.ts";

export function scheduleReady(
  runRoot: string,
  actor: string,
  maximum: number | null,
): { state: Record<string, unknown>; tasks: Record<string, unknown>[] } {
  const at = new Date().toISOString();
  let selectedIds: string[] = [];
  const state = transact(runRoot, actor, "tasks-scheduled", {}, (draft) => {
    const selected = proposeBatch(draft, maximum);
    selectedIds = selected.map(({ id }) => id);
    const tasks = draft.tasks as Record<string, Record<string, unknown>>;
    const graph = draft.graph as Record<string, unknown>;
    const nodes = graph.nodes as Record<string, unknown>[];
    for (const id of selectedIds) {
      const task = tasks[id]!;
      if (task.status !== "proposed") continue;
      task.status = "ready";
      const history = Array.isArray(task.history) ? task.history : [];
      history.push({
        at,
        actor,
        from: "proposed",
        to: "ready",
        reason: "scheduled dependencies are done",
        attempt: Array.isArray(task.attempts) ? task.attempts.length : 0,
      });
      task.history = history;
      const node = nodes.find((candidate) => candidate.id === id);
      if (node) node.status = "ready";
    }
  });
  const tasks = state.tasks as Record<string, Record<string, unknown>>;
  return { state, tasks: selectedIds.map((id) => structuredClone(tasks[id]!)) as JsonObject[] };
}
