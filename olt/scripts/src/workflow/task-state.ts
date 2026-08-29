import { HarnessError } from "../core/errors/index.ts";
import type { TaskRecord, WorkflowState } from "./types.ts";

export { jsonCopy } from "../core/json.ts";

export function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HarnessError("INVALID_ARGUMENT", `${field} must be non-blank text`);
  }
  return value;
}

export function taskIn(state: WorkflowState, taskId: string): TaskRecord {
  const task = state.tasks[requireText(taskId, "task_id")];
  if (!task) throw new HarnessError("INVALID_ARGUMENT", `unknown task: ${taskId}`);
  return task;
}

export function utc(date: Date): string {
  if (Number.isNaN(date.valueOf())) throw new HarnessError("INVALID_ARGUMENT", "invalid date");
  return date.toISOString();
}

export function transition(
  task: TaskRecord,
  to: TaskRecord["status"],
  actor: string,
  at: Date,
  reason: string,
): void {
  const from = task.status;
  task.status = to;
  task.history.push({
    at: utc(at),
    actor: requireText(actor, "actor"),
    from,
    to,
    reason,
    attempt: task.attempts.length,
  });
}

export function taskRequirements(task: TaskRecord): Set<string> {
  return new Set(task.requirement_ids);
}
