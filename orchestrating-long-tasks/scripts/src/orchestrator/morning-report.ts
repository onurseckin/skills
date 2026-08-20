import type { WorkflowState } from "../workflow/types.ts";
import { DEAD_AGENT_RECLAIMED_KIND } from "./dead-agent-detector.ts";
import { DISPATCH_OUTCOME_KIND, type DispatchLogEvent } from "./dispatch-log.ts";

/**
 * B28.4's contract: "what completed, what escalated and why, what was retried and how often, where
 * the time went, what needs a human" — answerable without reading logs. Every field here is read
 * back from what the harness already recorded; nothing is estimated or inferred from a task's name.
 */
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

export interface MorningReport {
  readonly generatedAt: string;
  readonly completed: readonly MorningReportTask[];
  /** Same list as `needsHuman`, kept as its own field so "escalated" reads as a fact, not a request. */
  readonly escalated: readonly EscalatedTaskReport[];
  readonly deadAgentsReclaimed: number;
  readonly retries: readonly RetryBreakdown[];
  /** Absent (never zero) when the run recorded no events to measure a span from. */
  readonly runSpanMs?: number;
  readonly totalBackoffMs: number;
  readonly needsHuman: readonly EscalatedTaskReport[];
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

function retryBreakdown(events: readonly DispatchLogEvent[]): RetryBreakdown[] {
  const byTask = new Map<string, { transient: number; deterministic: number }>();
  for (const event of events) {
    if (event.kind !== DISPATCH_OUTCOME_KIND || event.payload.outcome !== "failed") continue;
    const taskId = event.payload.task_id;
    if (typeof taskId !== "string") continue;
    const entry = byTask.get(taskId) ?? { transient: 0, deterministic: 0 };
    if (event.payload.failure_class === "deterministic") entry.deterministic += 1;
    else entry.transient += 1;
    byTask.set(taskId, entry);
  }
  return [...byTask.entries()].map(([taskId, counts]) => ({
    taskId,
    transientRetries: counts.transient,
    deterministicStops: counts.deterministic,
  }));
}

function totalBackoffMs(events: readonly DispatchLogEvent[]): number {
  let total = 0;
  for (const event of events) {
    if (event.kind !== DISPATCH_OUTCOME_KIND) continue;
    const retryAt = event.payload.retry_at;
    if (typeof retryAt !== "string") continue;
    const delay = Date.parse(retryAt) - Date.parse(event.timestamp);
    if (Number.isFinite(delay) && delay > 0) total += delay;
  }
  return total;
}

function runSpanMs(events: readonly DispatchLogEvent[]): number | undefined {
  const timestamps = events.map((event) => Date.parse(event.timestamp)).filter(Number.isFinite);
  if (timestamps.length === 0) return undefined;
  return Math.max(...timestamps) - Math.min(...timestamps);
}

export function buildMorningReport(
  state: WorkflowState,
  events: readonly DispatchLogEvent[],
  generatedAt: Date,
): MorningReport {
  const tasks = Object.values(state.tasks);
  const completed = tasks
    .filter((task) => task.status === "done")
    .map((task) => ({ taskId: task.id, label: taskLabel(state, task.id) }));
  const escalated = tasks
    .filter((task) => task.status === "escalated")
    .map((task) => escalationReport(state, task.id));
  const deadAgentsReclaimed = events.filter((event) => event.kind === DEAD_AGENT_RECLAIMED_KIND).length;
  const span = runSpanMs(events);

  return {
    generatedAt: generatedAt.toISOString(),
    completed,
    escalated,
    deadAgentsReclaimed,
    retries: retryBreakdown(events),
    ...(span === undefined ? {} : { runSpanMs: span }),
    totalBackoffMs: totalBackoffMs(events),
    needsHuman: escalated,
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
    `- **Dead agents reclaimed**: ${report.deadAgentsReclaimed}`,
    "- **Retries**:",
    ...(report.retries.length === 0 ? ["  - none"] : report.retries.map(retryLine)),
    `- **Run span**: ${report.runSpanMs === undefined ? "unknown" : `${report.runSpanMs}ms`}`,
    `- **Time spent backing off**: ${report.totalBackoffMs}ms`,
  ].join("\n");
}
