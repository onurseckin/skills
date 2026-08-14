import { HarnessError } from "../errors/harness-error.ts";
import type { JsonValue } from "../contracts/json.ts";
import type { TaskRecord, WorkflowState } from "./types.ts";

export function jsonCopy<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as unknown as T;
}

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
