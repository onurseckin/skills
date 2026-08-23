import { HarnessError } from "../../errors/harness-error.ts";
import { requireText, taskIn, transition } from "../task-state.ts";
import { systemClock, type Clock, type TransactionPort } from "../types.ts";
import { closeAttemptAsAbandoned, isAttemptOpen } from "./attempt-state.ts";

export function abandonAttempt(
  port: TransactionPort,
  taskId: string,
  actor: string,
  reason: string,
  clock: Clock = systemClock,
): ReturnType<TransactionPort["read"]> {
  actor = requireText(actor, "actor");
  reason = requireText(reason, "reason");
  const now = clock.now();
  return port.transact(actor, "attempt-abandoned", { task_id: taskId, reason }, (draft) => {
    const task = taskIn(draft, taskId);
    if (task.status === "validating") {
      delete task.validations;
      transition(task, "submitted", actor, now, `validation abandoned: ${reason}`);
      return;
    }
    const attempt = task.attempts.at(-1);
    if (!attempt || !isAttemptOpen(attempt)) {
      throw new HarnessError("INVALID_STATE", `task ${taskId} has no open attempt to abandon`);
    }
    closeAttemptAsAbandoned(attempt, actor, reason, now);
    if (task.lease) {
      const repair = attempt.kind === "repair";
      delete task.lease;
      transition(
        task,
        repair ? "changes_requested" : "retry_ready",
        actor,
        now,
        `attempt abandoned: ${reason}`,
      );
    }
  });
}
