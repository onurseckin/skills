import { claimTaskLease } from "../../task/queue/index.ts";
import { resolveTraceContext } from "../../telemetry/trace-context.ts";
import { parseArguments } from "../arguments.ts";
import { assertFlags, integerFlag, textFlag, type CommandContext, type Flags } from "../options.ts";

const ALLOWED_TASK_LEASE_FLAGS: readonly string[] = [
  "task",
  "task-id",
  "id",
  "agent",
  "agent-id",
  "lease-duration",
  "duration-seconds",
  "duration",
  "queue-path",
  "path",
  "run",
  "trace-id",
  "span-id",
  "parent-span-id",
  "trace-sampled",
];

export function taskLeaseCommand(flags: Flags, _context?: CommandContext): Record<string, unknown> {
  const taskId =
    textFlag(flags, "task", false) ??
    textFlag(flags, "task-id", false) ??
    textFlag(flags, "id", true)!;
  const rawAgent = textFlag(flags, "agent", false) ?? textFlag(flags, "agent-id", false);
  const agentId = rawAgent !== undefined ? rawAgent : "agent-worker";
  const durationSeconds =
    integerFlag(flags, "lease-duration") ??
    integerFlag(flags, "duration-seconds") ??
    integerFlag(flags, "duration");
  const queuePath =
    textFlag(flags, "queue-path", false) ??
    textFlag(flags, "path", false) ??
    textFlag(flags, "run", false);

  const result = claimTaskLease({
    taskId,
    agentId,
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    ...(queuePath !== undefined ? { customPath: queuePath } : {}),
  });

  return {
    task: result.task,
    leaseToken: result.leaseToken,
    token: result.leaseToken,
  };
}

export async function executeTaskLease(argv: readonly string[]): Promise<number> {
  try {
    const normalizedArgv =
      argv.length === 0 || argv[0]?.startsWith("-") ? ["task:lease", ...argv] : argv;
    const parsed = parseArguments(normalizedArgv);
    assertFlags(parsed.flags, ALLOWED_TASK_LEASE_FLAGS);
    const traceContext = resolveTraceContext(parsed.flags);
    const result = taskLeaseCommand(parsed.flags);
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
