import { gateStatusLine } from "./gate-status.ts";
import type { GateOverallStatus, LoopExecutionStatus, RoundTelemetry } from "./types.ts";

export interface LoopSummaryBriefInput {
  readonly loopId: string;
  readonly baseRunId: string;
  readonly totalRoundsExecuted: number;
  readonly maxRoundsConfigured: number;
  readonly finalStatus: LoopExecutionStatus;
  readonly overallDurationMs: number;
  readonly rounds: readonly RoundTelemetry[];
  readonly totalFindingsSynthesized: number;
  readonly gateStatus: GateOverallStatus;
  readonly finalCriticDecision?: RoundTelemetry["criticDecision"] | undefined;
}

function roundGateCell(round: RoundTelemetry): string {
  return round.gateCount === 0 ? "`not_run` (0)" : `\`${round.gateStatus}\` (${round.gateCount})`;
}

export function formatLoopMarkdownSummary(summary: LoopSummaryBriefInput): string {
  const lines: string[] = [
    `# Autonomous Multi-Round Loop Summary: \`${summary.baseRunId}\``,
    "",
    `- **Loop ID:** \`${summary.loopId}\``,
    `- **Final Status:** \`${summary.finalStatus}\``,
    `- **Total Rounds Executed:** ${summary.totalRoundsExecuted} / ${summary.maxRoundsConfigured}`,
    `- **Overall Duration:** ${(summary.overallDurationMs / 1000).toFixed(2)}s`,
    `- **Total Synthesized Findings:** ${summary.totalFindingsSynthesized}`,
    gateStatusLine(summary.gateStatus),
    `- **Final Critic Decision:** \`${summary.finalCriticDecision ?? "none"}\``,
    "",
    "## Round Execution Breakdown",
    "",
    "| Round | Run ID | Status | Critic Decision | Tasks Done | Open Findings | Gates | Duration |",
    "| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |",
  ];

  for (const round of summary.rounds) {
    lines.push(
      `| Round ${round.round} | \`${round.runId}\` | \`${round.status}\` | \`${round.criticDecision ?? "n/a"}\` | ${round.completedTaskCount}/${round.taskCount} | ${round.openFindingsCount} | ${roundGateCell(round)} | ${(round.durationMs / 1000).toFixed(2)}s |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}
