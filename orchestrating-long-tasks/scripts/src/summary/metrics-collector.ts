import type { HarnessEvent, Manifest } from "../contracts/capsule.ts";
import type { CommandRecord } from "../contracts/commands.ts";
import type { TaskRecord, WorkflowState } from "../workflow/types.ts";
import type { FileChurnRecord, RollupMetrics, TokenEstimation } from "./types.ts";

export interface MetricsInput {
  runId: string;
  manifest?: Manifest;
  state: Readonly<WorkflowState>;
  events: readonly HarnessEvent[];
  commands?: Record<string, CommandRecord>;
}

function parseDurationMs(startedAt?: string, finishedAt?: string | null): number {
  if (!startedAt || !finishedAt) return 0;
  const start = Date.parse(startedAt);
  const end = Date.parse(finishedAt);
  return isNaN(start) || isNaN(end) || end < start ? 0 : end - start;
}

function computeWallDurationMs(events: readonly HarnessEvent[]): number {
  if (events.length < 2) return 0;
  const first = events[0]?.timestamp;
  const last = events[events.length - 1]?.timestamp;
  return parseDurationMs(first, last);
}

function computeTokenEstimations(
  manifest: Manifest | undefined,
  tasks: TaskRecord[],
  commands: CommandRecord[],
): TokenEstimation {
  const promptBytes = manifest?.prompt_bytes ?? 0;
  let stdoutBytes = 0;
  for (const cmd of commands) {
    stdoutBytes += cmd.logs?.stdout?.bytes ?? 0;
  }
  let taskSummaryBytes = 0;
  let reportBytes = 0;
  for (const task of tasks) {
    if (task.report) {
      const summaryStr = typeof task.report.summary === "string" ? task.report.summary : "";
      taskSummaryBytes += summaryStr.length * 4;
      reportBytes += JSON.stringify(task.report).length;
    }
  }

  const tokensIn = Math.round((promptBytes + reportBytes + stdoutBytes) / 4);
  const tokensOut = Math.round((taskSummaryBytes + (tasks.length * 200)) / 4);
  return {
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    total_tokens: tokensIn + tokensOut,
  };
}

function computeFilesTouched(tasks: TaskRecord[]): FileChurnRecord[] {
  const fileMap = new Map<string, FileChurnRecord>();
  for (const task of tasks) {
    const changedRaw = task.report?.files_changed;
    const changed: readonly string[] = Array.isArray(changedRaw)
      ? (changedRaw.filter((f): f is string => typeof f === "string"))
      : task.write_scope;
    for (const filePath of changed) {
      if (!fileMap.has(filePath)) {
        fileMap.set(filePath, {
          path: filePath,
          additions: 0,
          deletions: 0,
        });
      }
    }
  }
  return Array.from(fileMap.values());
}

export function collectMetrics(input: MetricsInput): RollupMetrics {
  const { runId, manifest, state, events } = input;
  const tasks = Object.values(state.tasks ?? {}) as TaskRecord[];
  const commandMap = { ...(state.commands ?? {}), ...(input.commands ?? {}) } as Record<string, CommandRecord>;
  const commands = Object.values(commandMap);

  let activeCommandDurationMs = 0;
  let totalGatesPassed = 0;
  for (const cmd of commands) {
    activeCommandDurationMs += parseDurationMs(cmd.started_at, cmd.finished_at);
    if (cmd.exit_code === 0) {
      totalGatesPassed++;
    }
  }

  let satisfiedTasks = 0;
  let failedTasks = 0;
  let repairRoundsTotal = 0;
  for (const task of tasks) {
    if (task.status === "done") satisfiedTasks++;
    else if (task.status === "cancelled" || task.status === "escalated") failedTasks++;
    repairRoundsTotal += task.repair_round ?? 0;
  }

  const estimatedTokens = computeTokenEstimations(manifest, tasks, commands);
  const filesTouched = computeFilesTouched(tasks);

  return {
    run_id: runId,
    total_tasks: tasks.length,
    satisfied_tasks: satisfiedTasks,
    failed_tasks: failedTasks,
    repair_rounds_total: repairRoundsTotal,
    wall_duration_ms: computeWallDurationMs(events),
    active_command_duration_ms: activeCommandDurationMs,
    total_commands_executed: commands.length,
    total_gates_passed: totalGatesPassed,
    estimated_tokens: estimatedTokens,
    files_touched: filesTouched,
  };
}
