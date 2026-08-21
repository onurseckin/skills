import type { CommandLogMetadata, CommandRecord } from "../contracts/commands.ts";
import type { JsonObject } from "../contracts/json.ts";
import { readLog } from "../summary/node-evidence.ts";
import type { WorkflowState } from "../workflow/types.ts";

export const COMMAND_OUTPUT_CEILING_BYTES = 32 * 1024;

export interface RecordedStream extends JsonObject {
  text: string;
  truncated: boolean;
}

export interface RecordedCommand extends JsonObject {
  command_id: string;
  argv: string[];
  cwd_relative: string;
  actor: string;
  gate_id: string | null;
  status: string;
  exit_code: number | null;
  started_at: string;
  finished_at: string | null;
  stdout?: RecordedStream;
  stderr?: RecordedStream;
}

function logsOf(
  command: CommandRecord,
): { stdout: CommandLogMetadata; stderr: CommandLogMetadata } | undefined {
  return command.logs ?? command.attempts?.at(-1)?.logs;
}

function stream(
  runRoot: string,
  log: CommandLogMetadata | undefined,
  maxBytes: number,
): RecordedStream | undefined {
  const read = readLog(log?.path, runRoot, maxBytes);
  return read ? { text: read.text, truncated: read.truncated } : undefined;
}

export function taskCommandEvidence(
  runRoot: string,
  state: WorkflowState,
  taskId: string,
  maxBytes: number = COMMAND_OUTPUT_CEILING_BYTES,
): RecordedCommand[] {
  return Object.values(state.commands)
    .filter((command) => command.task_id === taskId)
    .sort((left, right) =>
      left.started_at === right.started_at
        ? left.id.localeCompare(right.id)
        : left.started_at.localeCompare(right.started_at),
    )
    .map((command) => {
      const logs = logsOf(command);
      const stdout = stream(runRoot, logs?.stdout, maxBytes);
      const stderr = stream(runRoot, logs?.stderr, maxBytes);
      return {
        command_id: command.id,
        argv: [...command.argv],
        cwd_relative: command.cwd_relative,
        actor: command.actor,
        gate_id: command.gate_id,
        status: command.status,
        exit_code: command.exit_code,
        started_at: command.started_at,
        finished_at: command.finished_at,
        ...(stdout ? { stdout } : {}),
        ...(stderr ? { stderr } : {}),
      };
    });
}
