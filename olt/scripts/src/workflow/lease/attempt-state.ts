import { HarnessError } from "../../errors/harness-error.ts";
import type { JsonObject } from "../../contracts/json.ts";
import { requireText, utc } from "../task-state.ts";
import type { TaskRecord } from "../types.ts";

export function isAttemptOpen(attempt: JsonObject): boolean {
  return typeof attempt.submitted_at !== "string" && typeof attempt.abandoned_at !== "string";
}

export function openAttempts(attempts: readonly JsonObject[]): JsonObject[] {
  return attempts.filter(isAttemptOpen);
}

export function closeAttemptAsAbandoned(
  attempt: JsonObject,
  actor: string,
  reason: string,
  at: Date,
): void {
  attempt.abandoned_at = utc(at);
  attempt.abandoned_by = requireText(actor, "actor");
  attempt.abandoned_reason = requireText(reason, "reason");
}

function describeAttempt(attempt: JsonObject): string {
  const attemptNumber = typeof attempt.attempt === "number" ? String(attempt.attempt) : "?";
  const agentId = typeof attempt.agent_id === "string" ? attempt.agent_id : "an unknown agent";
  const role = typeof attempt.role === "string" ? attempt.role : "unknown role";
  return `attempt ${attemptNumber} by ${agentId} (${role})`;
}

export function assertAttemptsClosed(task: TaskRecord, verb: string): void {
  const [open] = openAttempts(task.attempts);
  if (!open) return;
  throw new HarnessError(
    "INVALID_STATE",
    `task ${task.id} has an open ${describeAttempt(open)} that was never submitted or ` +
      `abandoned; submit it, run recoverStale to reclaim an expired lease, or run ` +
      `task:abandon to close it explicitly before the task can ${verb}`,
  );
}
