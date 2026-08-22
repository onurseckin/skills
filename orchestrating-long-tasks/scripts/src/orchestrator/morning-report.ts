import type { WorkflowState } from "../workflow/types.ts";
import { DEAD_AGENT_RECLAIMED_KIND } from "./dead-agent-detector.ts";
import { DISPATCH_OUTCOME_KIND, type DispatchLogEvent } from "./dispatch-log.ts";
import { changesRequestedTasks, type ChangesRequestedTask } from "./supervision-tick.ts";

export interface MorningReportTask {
  readonly taskId: string;
  readonly label: string;
}

export interface EscalatedTaskReport {
  readonly taskId: string;
  readonly reason: string;
  readonly evidence: string;
}

export interface RetryBreakdown {
  readonly taskId: string;
  readonly transientRetries: number;
  readonly deterministicStops: number;
}

export interface ConcurrencyCeilings {
  readonly maxParallel?: number;
  readonly gateMaxParallel?: number;
}

export interface MorningReport {
  readonly generatedAt: string;
  readonly completed: readonly MorningReportTask[];
  readonly escalated: readonly EscalatedTaskReport[];
  readonly changesRequested: readonly ChangesRequestedTask[];
  readonly deadAgentsReclaimed: number;
  readonly retries: readonly RetryBreakdown[];
  readonly runSpanMs?: number;
  readonly totalBackoffMs: number;
  readonly needsHuman: readonly EscalatedTaskReport[];
  readonly occupiedAtReport: number;
  readonly ceilings: ConcurrencyCeilings;
}

function taskLabel(state: WorkflowState, taskId: string): string {
  const label = state.tasks[taskId]?.label;
  return typeof label === "string" ? label : taskId;
}

function escalationReport(state: WorkflowState, taskId: string): EscalatedTaskReport {
  const task = state.tasks[taskId];
  const reason = task?.escalation_reason;
  const evidence = task?.escalation_evidence;
  return {
    taskId,
    reason: typeof reason === "string" ? reason : "unknown",
    evidence: typeof evidence === "string" ? evidence : "unknown",
  };
}

function retryBreakdown(events: readonly DispatchLogEvent[] = []): RetryBreakdown[] {
  const safeEvents = events ?? [];
  const byTask = new Map<string, { transient: number; deterministic: number }>();
  for (const event of safeEvents) {
    if (!event || event.kind !== DISPATCH_OUTCOME_KIND || event.payload?.outcome !== "failed") continue;
    const taskId = event.payload?.task_id;
    if (typeof taskId !== "string") continue;
    const entry = byTask.get(taskId) ?? { transient: 0, deterministic: 0 };
    if (event.payload?.failure_class === "deterministic") entry.deterministic += 1;
    else entry.transient += 1;
    byTask.set(taskId, entry);
  }
  return [...byTask.entries()].map(([taskId, counts]) => ({
    taskId,
    transientRetries: counts.transient,
    deterministicStops: counts.deterministic,
  }));
}

function totalBackoffMs(events: readonly DispatchLogEvent[] = []): number {
  const safeEvents = events ?? [];
  let total = 0;
  for (const event of safeEvents) {
    if (!event || event.kind !== DISPATCH_OUTCOME_KIND) continue;
    const retryAt = event.payload?.retry_at;
    if (typeof retryAt !== "string") continue;
    const delay = Date.parse(retryAt) - Date.parse(event.timestamp);
    if (Number.isFinite(delay) && delay > 0) total += delay;
  }
  return total;
}

function runSpanMs(events: readonly DispatchLogEvent[] = []): number | undefined {
  const safeEvents = events ?? [];
  const timestamps = safeEvents
    .filter((event) => event && typeof event.timestamp === "string")
    .map((event) => Date.parse(event.timestamp))
    .filter(Number.isFinite);
  if (timestamps.length === 0) return undefined;
  return Math.max(...timestamps) - Math.min(...timestamps);
}

export function buildMorningReport(
  state: WorkflowState,
  events: readonly DispatchLogEvent[] = [],
  generatedAt: Date,
  ceilings: ConcurrencyCeilings = {},
): MorningReport {
  const safeEvents = events ?? [];
  const tasks = Object.values(state.tasks);
  const completed = tasks
    .filter((task) => task.status === "done")
    .map((task) => ({ taskId: task.id, label: taskLabel(state, task.id) }));
  const escalated = tasks
    .filter((task) => task.status === "escalated")
    .map((task) => escalationReport(state, task.id));
  const changesRequested = changesRequestedTasks(state);
  const deadAgentsReclaimed = safeEvents.filter(
    (event) => event?.kind === DEAD_AGENT_RECLAIMED_KIND,
  ).length;
  const span = runSpanMs(safeEvents);
  const occupiedAtReport = tasks.filter((task) => task.lease !== undefined).length;

  return {
    generatedAt: generatedAt.toISOString(),
    completed,
    escalated,
    changesRequested,
    deadAgentsReclaimed,
    retries: retryBreakdown(safeEvents),
    ...(span === undefined ? {} : { runSpanMs: span }),
    totalBackoffMs: totalBackoffMs(safeEvents),
    needsHuman: escalated,
    occupiedAtReport,
    ceilings,
  };
}

function retryLine(entry: RetryBreakdown): string {
  const transient = `${entry.transientRetries} transient retr${entry.transientRetries === 1 ? "y" : "ies"}`;
  const deterministic = `${entry.deterministicStops} deterministic stop${entry.deterministicStops === 1 ? "" : "s"}`;
  return `  - \`${entry.taskId}\`: ${transient}, ${deterministic}`;
}

export function formatMorningReportMarkdown(report: MorningReport, runId: string): string {
  return [
    `### Morning Report: \`${runId}\``,
    `- **Generated**: ${report.generatedAt}`,
    `- **Completed**: ${report.completed.length}`,
    ...report.completed.map((task) => `  - \`${task.taskId}\` ${task.label}`),
    `- **Escalated (needs a human)**: ${report.escalated.length}`,
    ...report.escalated.map((task) => `  - \`${task.taskId}\`: ${task.reason} — ${task.evidence}`),
    `- **Awaiting repair (changes_requested)**: ${report.changesRequested.length}`,
    ...report.changesRequested.map((task) => `  - \`${task.taskId}\`: ${task.reason}`),
    `- **Dead agents reclaimed**: ${report.deadAgentsReclaimed}`,
    "- **Retries**:",
    ...(report.retries.length === 0 ? ["  - none"] : report.retries.map(retryLine)),
    `- **Run span**: ${report.runSpanMs === undefined ? "unknown" : `${report.runSpanMs}ms`}`,
    `- **Time spent backing off**: ${report.totalBackoffMs}ms`,
    `- **Occupancy at report time**: ${report.occupiedAtReport}/${report.ceilings.maxParallel ?? "unknown"} general ceiling, gate ceiling ${report.ceilings.gateMaxParallel ?? "unknown"}`,
  ].join("\n");
}
