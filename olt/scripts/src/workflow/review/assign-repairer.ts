import { HarnessError } from "../../core/errors/index.ts";
import { requireText, taskIn } from "../task-state.ts";
import type { TransactionPort } from "../types.ts";

export type ReplacementReason = "repeated_failure" | "stale" | "unavailable";

export function assignReplacementRepairer(
  port: TransactionPort,
  taskId: string,
  replacementId: string,
  actor: string,
  reason: ReplacementReason,
  evidence: string,
) {
  replacementId = requireText(replacementId, "replacement_id");
  evidence = requireText(evidence, "replacement_evidence");
  return port.transact(
    actor,
    "replacement-repairer-assigned",
    {
      task_id: taskId,
      replacement_id: replacementId,
      reason,
      evidence,
    },
    (draft) => {
      const task = taskIn(draft, taskId);
      if (task.status !== "changes_requested" || !task.original_implementer) {
        throw new HarnessError("INVALID_STATE", "task is not awaiting its original repairer");
      }
      if (replacementId === task.original_implementer) {
        throw new HarnessError(
          "INVALID_ARGUMENT",
          "replacement must differ from original implementer",
        );
      }
      const allValidations = [...(task.validations ?? []), ...(task.validation_history ?? [])];
      if (allValidations.some((v) => v.validator_id === replacementId)) {
        throw new HarnessError(
          "INVALID_ARGUMENT",
          `replacement repairer '${replacementId}' cannot be a validator of task '${taskId}' (anti-boundary-leak rule)`,
        );
      }
      if (reason === "repeated_failure" && task.repair_round < 2) {
        throw new HarnessError("INVALID_STATE", "original implementer has not failed repeatedly");
      }
      const lastAttempt = task.attempts.at(-1);
      if (
        reason === "stale" &&
        !(lastAttempt?.kind === "repair" && lastAttempt.result === "stale")
      ) {
        throw new HarnessError("INVALID_STATE", "original repair lease is not stale");
      }
      task.repair_assignee = replacementId;
      task.replacement_reason = reason;
      task.replacement_evidence = evidence;
    },
  );
}
