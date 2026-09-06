import { existsSync, lstatSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { loadRun } from "../../engine/store/index.ts";
import {
  getTaskQueueStats,
  listTaskQueue,
  type TaskPriority,
  type TaskQueueItem,
  type TaskQueueStatus,
} from "../../task/queue/index.ts";
import { resolveTraceContext } from "../../telemetry/trace-context.ts";
import { parseArguments } from "../arguments.ts";
import { formatTable } from "../formatters/index.ts";
import { assertFlags, integerFlag, textFlag, type CommandContext, type Flags } from "../options.ts";

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
  "capsule",
  "trace-id",
  "span-id",
  "parent-span-id",
  "trace-sampled",
];

function extractCapsuleTasks(
  loadedState: Record<string, unknown> | undefined,
): Record<string, unknown>[] {
  if (loadedState === undefined) return [];
  if (loadedState.tasks && typeof loadedState.tasks === "object") {
    return Object.values(loadedState.tasks as Record<string, Record<string, unknown>>);
  }
  if (Array.isArray(loadedState.planning_tasks))
    return loadedState.planning_tasks as Record<string, unknown>[];
  const graphObj = loadedState.graph;
  if (
    typeof graphObj === "object" &&
    graphObj !== null &&
    "nodes" in graphObj &&
    Array.isArray((graphObj as Record<string, unknown>).nodes)
  ) {
    return ((graphObj as Record<string, unknown>).nodes as Record<string, unknown>[]).filter(
      (n) => n.type === "task",
    );
  }
  return [];
}

function executeTaskListWithRun(
  run: string,
  flags: Flags,
  context?: CommandContext,
): Record<string, unknown> {
  let tasks: Record<string, unknown>[] = [];
  try {
    const loaded = loadRun(run, false);
    tasks = extractCapsuleTasks(loaded.state as Record<string, unknown> | undefined);
  } catch {
    const stateFile = join(run, "state.json");
    if (existsSync(stateFile)) {
      try {
        tasks = extractCapsuleTasks(
          JSON.parse(readFileSync(stateFile, "utf-8")) as Record<string, unknown>,
        );
      } catch {
        tasks = [];
      }
    }
  }
  if (tasks.length === 0 && existsSync(run)) {
    if (lstatSync(run).isFile()) return baseTaskList(flags, run);
    const q1 = join(run, "tasks.jsonl");
    const q2 = join(run, ".olt", "tasks.jsonl");
    const queueFile = existsSync(q1) ? q1 : existsSync(q2) ? q2 : undefined;
    if (queueFile !== undefined) return baseTaskList(flags, queueFile);
  }

  const statusFilter = textFlag(flags, "status", false)?.toLowerCase();
  if (statusFilter !== undefined) {
    tasks = tasks.filter((t) => {
      const s = String(t.status ?? "").toLowerCase();
      if (s === statusFilter) return true;
      if (statusFilter === "pending" && ["ready", "retry_ready", "proposed"].includes(s))
        return true;
      if (statusFilter === "in_progress" && ["leased", "running"].includes(s)) return true;
      return statusFilter === "completed" && s === "done";
    });
  }

  const priorityFilter = textFlag(flags, "priority", false)?.toLowerCase();
  if (priorityFilter !== undefined) {
    tasks = tasks.filter((t) => String(t.priority ?? "").toLowerCase() === priorityFilter);
  }

  const agentTarget = textFlag(flags, "agent", false) ?? textFlag(flags, "agent-id", false);
  const agentFilter = agentTarget?.toLowerCase();
  if (agentFilter !== undefined) {
    tasks = tasks.filter((t) => {
      const lease = t.lease as Record<string, unknown> | undefined;
      const chosen = lease?.agent_id ?? t.original_implementer;
      return String(chosen ?? "").toLowerCase() === agentFilter;
    });
  }

  const searchFilter = textFlag(flags, "search", false)?.toLowerCase();
  if (searchFilter !== undefined) {
    tasks = tasks.filter((t) => {
      const id = String(t.id ?? "").toLowerCase();
      const label = String(t.label ?? t.title ?? "").toLowerCase();
      return id.includes(searchFilter) || label.includes(searchFilter);
    });
  }

  tasks.sort((a, b) => {
    const pA = Number(a.priority ?? 50);
    const pB = Number(b.priority ?? 50);
    if (pB !== pA) return pB - pA;
    return String(a.id ?? "").localeCompare(String(b.id ?? ""));
  });

  const stats: Record<string, number> = { total: tasks.length };
  for (const t of tasks) {
    const s = String(t.status ?? "unknown");
    stats[s] = (stats[s] ?? 0) + 1;
  }

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
  const paginatedTasks = tasks.slice(offset, offset + limit);

  const runName = basename(run);
  const rows = paginatedTasks.map((t) => {
    const id = String(t.id ?? "");
    const label = String(t.label ?? t.title ?? id);
    const status = String(t.status ?? "unknown");
    const priority = String(t.priority ?? "50");
    const lease = t.lease as Record<string, unknown> | undefined;
    return [id, label, status, priority, String(lease?.agent_id ?? "-")];
  });
  const tableLines = formatTable(
    ["Task ID", "Label / Title", "Status", "Priority", "Assignee"],
    rows,
  );
  const breakdownEntries = Object.entries(stats)
    .filter(([k]) => k !== "total")
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
  const breakdown = breakdownEntries.length > 0 ? breakdownEntries : "none";
  const markdown = [
    `### Capsule Tasks: ${runName}`,
    `- **Total Tasks**: ${tasks.length} (showing ${paginatedTasks.length})`,
    `- **Status Breakdown**: ${breakdown}`,
    "",
    ...tableLines,
  ].join("\n");

  return {
    tasks: paginatedTasks,
    stats,
    total: tasks.length,
    count: paginatedTasks.length,
    offset,
    limit,
    run_root: run,
    markdown,
  };
}

function baseTaskList(flags: Flags, customQueuePath?: string): Record<string, unknown> {
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
    customQueuePath ??
    textFlag(flags, "queue-path", false) ??
    textFlag(flags, "path", false) ??
    textFlag(flags, "run", false);
  const allMatching = listTaskQueue({ status, priority, agentId, search, customPath: queuePath });

  let paginatedTasks: TaskQueueItem[] = allMatching.slice(offset, offset + limit);
  let truncated = false;
  if (Buffer.byteLength(JSON.stringify(paginatedTasks), "utf-8") > MAX_COWAN_PAYLOAD_BYTES) {
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
    total: allMatching.length,
    count: paginatedTasks.length,
    offset,
    limit,
    truncated,
  };
}

export function taskListCommand(flags: Flags, context?: CommandContext): Record<string, unknown> {
  const run = (textFlag(flags, "run", false) ?? textFlag(flags, "capsule", false))?.trim();
  if (run !== undefined && run.length > 0) {
    return executeTaskListWithRun(run, flags, context);
  }
  return baseTaskList(flags);
}

export async function executeTaskList(argv: readonly string[]): Promise<number> {
  try {
    const normalizedArgv =
      argv.length === 0 || argv[0]?.startsWith("-") ? ["task:list", ...argv] : argv;
    const parsed = parseArguments(normalizedArgv);
    assertFlags(parsed.flags, ALLOWED_TASK_LIST_FLAGS);
    const traceContext = resolveTraceContext(parsed.flags);
    const result = taskListCommand(parsed.flags);
    process.stdout.write(`${JSON.stringify({ ...result, traceContext }, null, 2)}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isValidation = [
      "required",
      "invalid",
      "unknown option",
      "INVALID_ARGUMENT",
      "INVARIANT_VIOLATION",
    ].some((s) => message.includes(s));
    process.stderr.write(
      `${JSON.stringify({ ok: false, error: message, code: isValidation ? 2 : 1 }, null, 2)}\n`,
    );
    return isValidation ? 2 : 1;
  }
}
