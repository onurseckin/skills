import { HarnessError } from "../../errors/harness-error.ts";
import { newLeaseToken, tokenDigest } from "../lease/token.ts";
import { requireText, taskIn, transition, utc } from "../task-state.ts";
import { systemClock, type Clock, type TransactionPort } from "../types.ts";

export function beginValidation(
  port: TransactionPort,
  taskId: string,
  validatorId: string,
  clock: Clock = systemClock,
) {
  validatorId = requireText(validatorId, "validator_id");
  const now = clock.now();
  const token = newLeaseToken();
  const state = port.transact(validatorId, "validation-started", { task_id: taskId }, (draft) => {
    const task = taskIn(draft, taskId);
    if (task.status !== "submitted")
      throw new HarnessError("INVALID_STATE", "task is not submitted");
    if (
      task.original_implementer === validatorId ||
      task.attempts.some((attempt) => attempt.agent_id === validatorId) ||
      task.history.some((entry) => entry.to === "validating" && entry.actor === validatorId)
    ) {
      throw new HarnessError("INVALID_STATE", "validator must be independent from implementers");
    }
    task.validation = {
      validator_id: validatorId,
      token_digest: tokenDigest(token),
      attempt: task.repair_round + 1,
      started_at: utc(now),
      deadline_at: utc(new Date(now.valueOf() + 1_200_000)),
    };
    transition(task, "validating", validatorId, now, "independent validation started");
  });
  state.tasks[taskId]!.validation_token = token;
  return state;
}
