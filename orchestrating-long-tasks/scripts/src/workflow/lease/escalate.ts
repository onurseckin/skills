import { HarnessError } from "../../errors/harness-error.ts";
import { requireText, taskIn, transition, utc } from "../task-state.ts";
import { systemClock, type Clock, type TransactionPort } from "../types.ts";

/**
 * Why a supervisor gave up on a task, distinct from `replacement_reason` (B8/`assign-repairer.ts`):
 * that field explains a human reassigning a live repair to a different implementer, this one
 * explains the supervisor pulling a task out of automatic circulation entirely (B28.3/B28.4).
 */
export type SupervisorEscalationReason =
  | "deterministic_failure"
  | "retry_budget_exhausted"
  | "agent_budget_reached";

/** A lease must be released or reclaimed first: escalating a task mid-flight would strand its agent. */
const ESCALATABLE_STATUSES: ReadonlySet<string> = new Set([
  "blocked",
  "changes_requested",
  "proposed",
  "ready",
  "retry_ready",
]);

/**
 * Pulls a task out of automatic dispatch and records why, so `queue:wave`/`queue:next` stop
 * offering it and a human reviewing the morning report (B28.4) sees the reason without reading logs.
 * Never called on a whim: the caller (B28.3's classifier) is expected to have already decided this
 * failure is deterministic, or that the retry budget is spent.
 */
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
      task.escalation_reason = reason;
      task.escalation_evidence = evidence;
      task.escalation_at = utc(now);
      transition(task, "escalated", actor, now, `supervisor escalation: ${reason}`);
    },
  );
}
