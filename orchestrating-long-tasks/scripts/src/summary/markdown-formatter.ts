import type { TaskRecord, WorkflowState } from "../workflow/types.ts";
import type { RollupMetrics, TimelineEventRecord } from "./types.ts";

export interface MarkdownFormatterInput {
  runId: string;
  metrics: RollupMetrics;
  timeline: TimelineEventRecord[];
  state: Readonly<WorkflowState>;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = (ms / 1000).toFixed(1);
  if (ms < 60_000) return `${sec}s`;
  const min = (ms / 60_000).toFixed(1);
  return `${min}m (${sec}s)`;
}

export function formatSummaryMarkdown(input: MarkdownFormatterInput): string {
  const { runId, metrics, timeline, state } = input;
  const tasks = Object.values(state.tasks ?? {}) as TaskRecord[];

  const lines: string[] = [];
  lines.push(`# Execution Run Summary: \`${runId}\``);
  lines.push("");
  lines.push("## Executive Metrics");
  lines.push("");
  lines.push("| Metric | Value | Metric | Value |");
  lines.push("| :--- | :--- | :--- | :--- |");
  lines.push(`| **Total Tasks** | ${metrics.total_tasks} | **Satisfied Tasks** | ${metrics.satisfied_tasks} / ${metrics.total_tasks} |`);
  lines.push(`| **Wall Duration** | ${formatDuration(metrics.wall_duration_ms)} | **Active Compute** | ${formatDuration(metrics.active_command_duration_ms)} |`);
  lines.push(`| **Commands Executed** | ${metrics.total_commands_executed} | **Gates Passed** | ${metrics.total_gates_passed} |`);
  lines.push(`| **Repair Rounds** | ${metrics.repair_rounds_total} | **Failed Tasks** | ${metrics.failed_tasks} |`);
  lines.push(`| **Est. Tokens In** | ${metrics.estimated_tokens.tokens_in.toLocaleString()} | **Est. Tokens Out** | ${metrics.estimated_tokens.tokens_out.toLocaleString()} |`);
  lines.push(`| **Total Tokens** | ${metrics.estimated_tokens.total_tokens.toLocaleString()} | **Files Touched** | ${metrics.files_touched.length} files |`);
  lines.push("");

  lines.push("## Task Trajectory & Validation Breakdown");
  lines.push("");
  lines.push("| Task ID | Label | Status | Agent | Repair Rounds | Write Scope |");
  lines.push("| :--- | :--- | :--- | :--- | :--- | :--- |");
  for (const t of tasks) {
    const label = typeof t.label === "string" ? t.label : t.id;
    const statusText = t.status === "done" ? "Done" : t.status === "changes_requested" ? "Repair" : t.status;
    const agent = t.lease?.agent_id ?? t.original_implementer ?? "-";
    const writeScope = t.write_scope.join(", ") || "-";
    lines.push(`| \`${t.id}\` | ${label} | ${statusText} | \`${agent}\` | ${t.repair_round ?? 0} | \`${writeScope}\` |`);
  }
  lines.push("");

  if (metrics.files_touched.length > 0) {
    lines.push("## Files Touched & Churn");
    lines.push("");
    lines.push("| File Path | Status | Additions | Deletions |");
    lines.push("| :--- | :--- | :--- | :--- |");
    for (const file of metrics.files_touched) {
      lines.push(`| \`${file.path}\` | Modified | +${file.additions} | -${file.deletions} |`);
    }
    lines.push("");
  }

  lines.push("## Timeline Milestones");
  lines.push("");
  lines.push("| # | Time (UTC) | Phase | Actor | Event Summary |");
  lines.push("| :--- | :--- | :--- | :--- | :--- |");
  const sampleEvents = timeline.length <= 15 ? timeline : [...timeline.slice(0, 8), ...timeline.slice(-7)];
  for (const event of sampleEvents) {
    const timeStr = event.timestamp.includes("T") ? event.timestamp.split("T")[1]?.slice(0, 8) ?? event.timestamp : event.timestamp;
    lines.push(`| ${event.sequence} | \`${timeStr}\` | **${event.phase}** | \`${event.actor}\` | ${event.summary} |`);
  }
  lines.push("");

  lines.push("---");
  lines.push(`*Generated deterministically by Capsule Summary Engine for GVUI Visualization.*`);
  lines.push(`*Preview in GVUI: \`bun run gvui:import --capsule <path>\`*`);
  lines.push("");

  return lines.join("\n");
}
