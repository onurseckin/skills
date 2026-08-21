import type { CommandRecord } from "../contracts/commands.ts";
import type { TaskRecord } from "../workflow/types.ts";

export interface ArchivedRoundContext {
  round: number;
  taskNodeId: string;
  validatorNodeId: string;
  validatorId: string;
  attempt?: number | undefined;
  startedAt?: string | undefined;
  deadlineAt?: string | undefined;
  commands: CommandRecord[];
}

export function archivedTaskNodeId(taskId: string, round: number): string {
  return `node-task-${taskId}-r${round}`;
}

export function archivedValidatorNodeId(taskId: string, round: number): string {
  return `node-validator-${taskId}-r${round}`;
}

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
