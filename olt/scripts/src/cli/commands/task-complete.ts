import { completeTask } from "../../task/queue/index.ts";
import { resolveTraceContext } from "../../telemetry/trace-context.ts";
import { parseArguments } from "../arguments.ts";
import {
  assertFlags,
  boolFlag,
  textFlag,
  type CommandContext,
  type Flags,
} from "../options.ts";

const ALLOWED_TASK_COMPLETE_FLAGS: readonly string[] = [
  "task",
  "task-id",
  "id",
  "agent",
  "agent-id",
  "lease-token",
  "token",
  "proof-summary",
  "proof",
  "test-path",
  "commit-sha",
  "auto-archive",
  "auto-prune",
  "completed-tasks-path",
  "archive-path",
  "queue-path",
  "path",
  "run",
  "trace-id",
  "span-id",
  "parent-span-id",
  "trace-sampled",
];

export function taskCompleteCommand(
  flags: Flags,
  _context?: CommandContext,
): Record<string, unknown> {
  const taskId =
    textFlag(flags, "task", false) ??
    textFlag(flags, "task-id", false) ??
    textFlag(flags, "id", true)!;
  const agentId = textFlag(flags, "agent", false) ?? textFlag(flags, "agent-id", false);
  const leaseToken = textFlag(flags, "lease-token", false) ?? textFlag(flags, "token", false);
  const proofSummary = textFlag(flags, "proof-summary", false) ?? textFlag(flags, "proof", false);
  const testPath = textFlag(flags, "test-path", false);
  const commitSha = textFlag(flags, "commit-sha", false);
  const autoArchive = boolFlag(flags, "auto-archive");
  const autoPrune = boolFlag(flags, "auto-prune");
  const completedTasksPath =
    textFlag(flags, "completed-tasks-path", false) ?? textFlag(flags, "archive-path", false);
  const queuePath =
    textFlag(flags, "queue-path", false) ??
    textFlag(flags, "path", false) ??
    textFlag(flags, "run", false);

  const result = completeTask({
    taskId,
    agentId,
    leaseToken,
    proofSummary,
    testPath,
    commitSha,
    autoArchive: autoArchive ? true : undefined,
    autoPrune: autoPrune ? true : undefined,
    completedTasksPath,
    customPath: queuePath,
  });

  return {
    task: result.completedTask,
    completedTask: result.completedTask,
    unblockedTasks: result.unblockedTasks,
    archivedRecord: result.archivedRecord,
  };
}

export async function executeTaskComplete(argv: readonly string[]): Promise<number> {
  try {
    const normalizedArgv =
      argv.length === 0 || argv[0]?.startsWith("-") ? ["task:complete", ...argv] : argv;
    const parsed = parseArguments(normalizedArgv);
    assertFlags(parsed.flags, ALLOWED_TASK_COMPLETE_FLAGS);
    const traceContext = resolveTraceContext(parsed.flags);
    const result = taskCompleteCommand(parsed.flags);
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
