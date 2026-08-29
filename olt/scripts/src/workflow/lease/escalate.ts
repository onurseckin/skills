import { HarnessError } from "../../core/errors/index.ts";
import { requireText, taskIn, transition, utc } from "../task-state.ts";
import { systemClock, type Clock, type TransactionPort } from "../types.ts";
import { assertAttemptsClosed } from "./attempt-state.ts";

export type SupervisorEscalationReason =
  | "deterministic_failure"
  | "retry_budget_exhausted"
  | "agent_budget_reached";

const ESCALATABLE_STATUSES: ReadonlySet<string> = new Set([
  "blocked",
  "changes_requested",
  "proposed",
  "ready",
  "retry_ready",
]);

export function escalateTask(
  port: TransactionPort,
  taskId: string,
  actor: string,
  reason: SupervisorEscalationReason,
  evidence: string,
  clock: Clock = systemClock,
): ReturnType<TransactionPort["read"]> {
  evidence = requireText(evidence, "escalation_evidence");
  const now = clock.now();
  return port.transact(
    actor,
    "task-escalated-by-supervisor",
    { task_id: taskId, reason, evidence },
    (draft) => {
      const task = taskIn(draft, taskId);
      if (task.lease !== undefined) {
        throw new HarnessError(
          "INVALID_STATE",
          "task holds a live lease; release or recover it before the supervisor can escalate it",
        );
      }
      if (!ESCALATABLE_STATUSES.has(task.status)) {
        throw new HarnessError(
          "INVALID_STATE",
          `task ${taskId} in status ${task.status} is not something the supervisor can escalate`,
        );
      }
      assertAttemptsClosed(task, "be escalated");
      task.escalation_reason = reason;
      task.escalation_evidence = evidence;
      task.escalation_at = utc(now);
      transition(task, "escalated", actor, now, `supervisor escalation: ${reason}`);
    },
  );
}
