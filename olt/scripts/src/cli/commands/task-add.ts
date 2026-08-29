import {
  enqueueTask,
  type NewTaskQueueInput,
  type TaskPriority,
  type TaskSourceType,
  type TaskQueueStatus,
} from "../../task/queue/index.ts";
import { resolveTraceContext } from "../../telemetry/trace-context.ts";
import { parseArguments } from "../arguments.ts";
import {
  assertFlags,
  integerFlag,
  listFlag,
  textFlag,
  type CommandContext,
  type Flags,
} from "../options.ts";

const ALLOWED_TASK_ADD_FLAGS: readonly string[] = [
  "task",
  "task-id",
  "id",
  "title",
  "name",
  "description",
  "desc",
  "priority",
  "gate",
  "write-scope",
  "scope",
  "charter-goals",
  "goals",
  "acceptance-criteria",
  "criteria",
  "dependencies",
  "deps",
  "source-type",
  "status",
  "assigned-tier",
  "tier",
  "assigned-role",
  "role",
  "max-retries",
  "queue-path",
  "path",
  "run",
  "trace-id",
  "span-id",
  "parent-span-id",
  "trace-sampled",
];

export function taskAddCommand(flags: Flags, _context?: CommandContext): Record<string, unknown> {
  const id =
    textFlag(flags, "task", false) ??
    textFlag(flags, "task-id", false) ??
    textFlag(flags, "id", false) ??
    `task-${Date.now()}`;
  const title = textFlag(flags, "title", false) ?? textFlag(flags, "name", false) ?? id;
  const description =
    textFlag(flags, "description", false) ?? textFlag(flags, "desc", false) ?? title;
  const priority = textFlag(flags, "priority", false) as TaskPriority | undefined;
  const rawGate = textFlag(flags, "gate", false);
  const gate = rawGate !== undefined ? rawGate : "bun test";
  const writeScope = listFlag(flags, "write-scope", false) ?? listFlag(flags, "scope", false) ?? [];
  const charterGoals = listFlag(flags, "charter-goals", false) ?? listFlag(flags, "goals", false);
  const acceptanceCriteria =
    listFlag(flags, "acceptance-criteria", false) ?? listFlag(flags, "criteria", false);
  const dependencies = listFlag(flags, "dependencies", false) ?? listFlag(flags, "deps", false);
  const sourceType = textFlag(flags, "source-type", false) as TaskSourceType | undefined;
  const status = textFlag(flags, "status", false) as TaskQueueStatus | undefined;
  const assignedTier = textFlag(flags, "assigned-tier", false) ?? textFlag(flags, "tier", false);
  const assignedRole = textFlag(flags, "assigned-role", false) ?? textFlag(flags, "role", false);
  const maxRetries = integerFlag(flags, "max-retries");
  const queuePath =
    textFlag(flags, "queue-path", false) ??
    textFlag(flags, "path", false) ??
    textFlag(flags, "run", false);

  const input: NewTaskQueueInput = {
    id,
    title,
    description,
    priority,
    gate,
    write_scope: writeScope,
    charter_goals: charterGoals,
    acceptance_criteria: acceptanceCriteria,
    dependencies,
    source_type: sourceType,
    status,
    assigned_tier: assignedTier,
    assigned_role: assignedRole,
    max_retries: maxRetries,
  };

  const task = enqueueTask(input, queuePath);
  return {
    ok: true,
    task,
    id: task.id,
  };
}

export async function executeTaskAdd(argv: readonly string[]): Promise<number> {
  try {
    const normalizedArgv =
      argv.length === 0 || argv[0]?.startsWith("-") ? ["task:add", ...argv] : argv;
    const parsed = parseArguments(normalizedArgv);
    assertFlags(parsed.flags, ALLOWED_TASK_ADD_FLAGS);
    const traceContext = resolveTraceContext(parsed.flags);
    const result = taskAddCommand(parsed.flags);
    const output = {
      ...result,
      traceContext,
    };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isValidation =
      message.includes("required") ||
      message.includes("invalid") ||
      message.includes("unknown option") ||
      message.includes("INVALID_ARGUMENT") ||
      message.includes("INVARIANT_VIOLATION");
    process.stderr.write(
      `${JSON.stringify({ ok: false, error: message, code: isValidation ? 2 : 1 }, null, 2)}\n`,
    );
    return isValidation ? 2 : 1;
  }
}
