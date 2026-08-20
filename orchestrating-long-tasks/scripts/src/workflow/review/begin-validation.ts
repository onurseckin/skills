import { HarnessError } from "../../errors/harness-error.ts";
import { newLeaseToken, tokenDigest } from "../lease/token.ts";
import { requireText, taskIn, transition, utc } from "../task-state.ts";
import { systemClock, type Clock, type TransactionPort } from "../types.ts";

const MIN_VALIDATION_WINDOW = 5;
const MAX_VALIDATION_WINDOW = 86_400;
const DEFAULT_VALIDATION_WINDOW = 1_200;

export function beginValidation(
  port: TransactionPort,
  taskId: string,
  validatorId: string,
  clock: Clock = systemClock,
  // Seconds until the validation deadline; --lease-duration on task:validate-start. Bounds mirror
  // claimTask's ClaimOptions.leaseSeconds, the implementer-side equivalent of this same window.
  leaseSeconds?: number,
) {
  validatorId = requireText(validatorId, "validator_id");
  if (
    leaseSeconds !== undefined &&
    (!Number.isSafeInteger(leaseSeconds) ||
      leaseSeconds < MIN_VALIDATION_WINDOW ||
      leaseSeconds > MAX_VALIDATION_WINDOW)
  ) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `lease_seconds must be an integer from ${MIN_VALIDATION_WINDOW} to ${MAX_VALIDATION_WINDOW}`,
    );
  }
  const windowMs = (leaseSeconds ?? DEFAULT_VALIDATION_WINDOW) * 1_000;
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
      deadline_at: utc(new Date(now.valueOf() + windowMs)),
    };
    transition(task, "validating", validatorId, now, "independent validation started");
  });
  state.tasks[taskId]!.validation_token = token;
  return state;
}
