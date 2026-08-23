import type { WorkflowState } from "../workflow/types.ts";

const TERMINAL_TASK_STATUSES = new Set(["done", "cancelled", "escalated"]);

export function isRunTerminal(state: WorkflowState): boolean {
  if (state.completion_result !== undefined) return true;
  const tasks = Object.values(state.tasks);
  return tasks.length > 0 && tasks.every((task) => TERMINAL_TASK_STATUSES.has(task.status));
}
