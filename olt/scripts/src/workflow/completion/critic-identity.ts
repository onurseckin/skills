import { HarnessError } from "../../core/errors/harness-error.ts";
import type { WorkflowState } from "../types.ts";
import { openValidations } from "../review/validation-state.ts";

export function assertCriticIndependent(state: WorkflowState, criticId: string): void {
  const conflicted = Object.values(state.tasks).some(
    (task) =>
      task.original_implementer === criticId ||
      task.repair_assignee === criticId ||
      task.lease?.agent_id === criticId ||
      task.attempts.some((attempt) => attempt.agent_id === criticId) ||
      openValidations(task).some((attempt) => attempt.validator_id === criticId) ||
      (task.validation_history ?? []).some((attempt) => attempt.validator_id === criticId),
  );
  if (conflicted)
    throw new HarnessError(
      "INVALID_STATE",
      "completeness critic must be independent from implementers, repairers, and validators",
    );
}
