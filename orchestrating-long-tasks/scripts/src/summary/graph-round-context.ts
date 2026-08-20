import type { CommandRecord } from "../contracts/commands.ts";
import type { TaskRecord } from "../workflow/types.ts";

/**
 * One completed, rejected round the run archived. `validation_history` is populated only when
 * `record-review` processed a genuine rejection (see workflow/review/record-review.ts), so an
 * entry here is a round the state machine actually lived through — never a round guessed from
 * `repair_round`, which only counts them and can disagree with this list on a capsule that
 * predates the field. The current/final round is never in this array: it stays whatever
 * `task.validation` or the task's live fields describe, exactly as before this split existed, so a
 * task still on its first round is untouched by any of it.
 */
export interface ArchivedRoundContext {
  round: number;
  taskNodeId: string;
  validatorNodeId: string;
  validatorId: string;
  attempt?: number | undefined;
  startedAt?: string | undefined;
  deadlineAt?: string | undefined;
  /** Resolved from the attempt's own `checks`, so this is exactly what that round's validator
   *  cited as evidence — never the task's whole command history split by guesswork. */
  commands: CommandRecord[];
}

/**
 * Superseded rounds always take a suffixed id. The live/current round keeps the plain
 * `node-task-${id}` / `node-validator-${id}` identity it always had, computed where that round's
 * context is built — so a single-round task's node ids never change, and any external reader that
 * already knows those ids keeps finding the task's latest state at them.
 */
export function archivedTaskNodeId(taskId: string, round: number): string {
  return `node-task-${taskId}-r${round}`;
}

export function archivedValidatorNodeId(taskId: string, round: number): string {
  return `node-validator-${taskId}-r${round}`;
}

/** Every rejected round the task lived through, oldest first, backed only by recorded checks. */
export function computeArchivedRounds(
  task: TaskRecord,
  taskCommands: readonly CommandRecord[],
): ArchivedRoundContext[] {
  const history = task.validation_history ?? [];
  const byId = new Map(taskCommands.map((command) => [command.id, command]));
  return history.map((attempt, index) => {
    const round = index + 1;
    const commands = (attempt.checks ?? [])
      .map((check) => byId.get(check.command_id))
      .filter((command): command is CommandRecord => command !== undefined);
    return {
      round,
      taskNodeId: archivedTaskNodeId(task.id, round),
      validatorNodeId: archivedValidatorNodeId(task.id, round),
      validatorId: attempt.validator_id,
      ...(attempt.attempt !== undefined ? { attempt: attempt.attempt } : {}),
      ...(attempt.started_at ? { startedAt: attempt.started_at } : {}),
      ...(attempt.deadline_at ? { deadlineAt: attempt.deadline_at } : {}),
      commands,
    };
  });
}
