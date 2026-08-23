import { isAttemptOpen } from "./attempt-state.ts";
import { leaseIsExpired } from "./suspension.ts";
import type {
  CompletionCriticAuthorization,
  TaskRecord,
  ValidationAttempt,
  WorkflowState,
} from "../types.ts";

export type TurnState = "open" | "closed" | "abandoned";

export function taskAttemptTurnState(task: TaskRecord, now: Date, graceMs: number): TurnState {
  const attempt = task.attempts.at(-1);
  if (!attempt || !isAttemptOpen(attempt)) return "closed";
  if (!task.lease) return "abandoned";
  return leaseIsExpired(task.lease, now, graceMs) ? "abandoned" : "open";
}

export function validationTurnState(
  entry: ValidationAttempt,
  now: Date,
  graceMs: number,
): TurnState {
  if (entry.verdict !== undefined) return "closed";
  const deadline = Date.parse(entry.deadline_at);
  return Number.isFinite(deadline) && deadline + graceMs <= now.valueOf() ? "abandoned" : "open";
}

export function openTaskValidations(task: TaskRecord): ValidationAttempt[] {
  if (task.status !== "validating") return [];
  return (task.validations ?? []).filter((entry) => entry.verdict === undefined);
}

export function abandonedTaskValidations(
  task: TaskRecord,
  now: Date,
  graceMs: number,
): ValidationAttempt[] {
  return openTaskValidations(task).filter(
    (entry) => validationTurnState(entry, now, graceMs) === "abandoned",
  );
}

const OPEN_CRITIC_STATUSES: ReadonlySet<CompletionCriticAuthorization["status"]> = new Set([
  "assigned",
  "packet_published",
]);

export function openCompletenessCritic(
  state: WorkflowState,
): CompletionCriticAuthorization | undefined {
  const critic = state.completion_critic;
  return critic && OPEN_CRITIC_STATUSES.has(critic.status) ? critic : undefined;
}

export function criticTurnState(
  critic: CompletionCriticAuthorization,
  now: Date,
  graceMs: number,
): TurnState {
  if (critic.status === "reviewed") return "closed";
  if (critic.status === "expired") return "abandoned";
  const deadline = Date.parse(critic.deadline_at);
  return Number.isFinite(deadline) && deadline + graceMs <= now.valueOf() ? "abandoned" : "open";
}

export function abandonedCompletenessCritic(
  state: WorkflowState,
  now: Date,
  graceMs: number,
): CompletionCriticAuthorization | undefined {
  const critic = openCompletenessCritic(state);
  if (!critic) return undefined;
  return criticTurnState(critic, now, graceMs) === "abandoned" ? critic : undefined;
}
