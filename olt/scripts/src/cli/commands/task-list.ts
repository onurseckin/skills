import {
  getTaskQueueStats,
  listTaskQueue,
  type TaskPriority,
  type TaskQueueItem,
  type TaskQueueStatus,
} from "../../task/queue/index.ts";
import { resolveTraceContext } from "../../telemetry/trace-context.ts";
import { parseArguments } from "../arguments.ts";
import {
  assertFlags,
  integerFlag,
  textFlag,
  type CommandContext,
  type Flags,
} from "../options.ts";

const DEFAULT_COWAN_LIMIT = 50;
const MAX_COWAN_PAYLOAD_BYTES = 409600;

const ALLOWED_TASK_LIST_FLAGS: readonly string[] = [
  "status",
  "priority",
  "agent",
  "agent-id",
  "search",
  "limit",
  "offset",
  "page",
  "stats",
  "queue-path",
  "path",
  "run",
  "trace-id",
  "span-id",
  "parent-span-id",
  "trace-sampled",
];

export function taskListCommand(flags: Flags, _context?: CommandContext): Record<string, unknown> {
  const status = textFlag(flags, "status", false) as TaskQueueStatus | undefined;
  const priority = textFlag(flags, "priority", false) as TaskPriority | undefined;
  const agentId = textFlag(flags, "agent", false) ?? textFlag(flags, "agent-id", false);
  const search = textFlag(flags, "search", false);
  const rawLimit = integerFlag(flags, "limit");
  const limit = rawLimit !== undefined && rawLimit > 0 ? rawLimit : DEFAULT_COWAN_LIMIT;
  const page = integerFlag(flags, "page");
  const rawOffset = integerFlag(flags, "offset");
  const offset =
    rawOffset !== undefined && rawOffset >= 0
      ? rawOffset
      : page !== undefined && page > 1
        ? (page - 1) * limit
        : 0;

  const queuePath =
    textFlag(flags, "queue-path", false) ??
    textFlag(flags, "path", false) ??
    textFlag(flags, "run", false);

  const allMatching = listTaskQueue({
    status,
    priority,
    agentId,
    search,
    customPath: queuePath,
  });

  const total = allMatching.length;
  let paginatedTasks: TaskQueueItem[] = allMatching.slice(offset, offset + limit);

  const serialized = JSON.stringify(paginatedTasks);
  let truncated = false;
  if (Buffer.byteLength(serialized, "utf-8") > MAX_COWAN_PAYLOAD_BYTES) {
    truncated = true;
    while (
      paginatedTasks.length > 1 &&
      Buffer.byteLength(JSON.stringify(paginatedTasks), "utf-8") > MAX_COWAN_PAYLOAD_BYTES
    ) {
      paginatedTasks = paginatedTasks.slice(0, paginatedTasks.length - 1);
    }
  }

  const stats = getTaskQueueStats(queuePath);

  return {
    tasks: paginatedTasks,
    stats,
    total,
    count: paginatedTasks.length,
    offset,
    limit,
    truncated,
  };
}

export async function executeTaskList(argv: readonly string[]): Promise<number> {
  try {
    const normalizedArgv =
      argv.length === 0 || argv[0]?.startsWith("-") ? ["task:list", ...argv] : argv;
    const parsed = parseArguments(normalizedArgv);
    assertFlags(parsed.flags, ALLOWED_TASK_LIST_FLAGS);
    const traceContext = resolveTraceContext(parsed.flags);
    const result = taskListCommand(parsed.flags);
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
