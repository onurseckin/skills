import { enforceLineLimit, formatTable } from "./line-limiter.ts";
import { gateStatusLine } from "../../orchestrator/gate-status.ts";
import type { GateOverallStatus, LoopSummary, RoundTelemetry } from "../../orchestrator/types.ts";

export interface OrchestratorRunBriefParams {
  readonly loopId: string;
  readonly baseRunId: string;
  readonly finalStatus: string;
  readonly totalRoundsExecuted: number;
  readonly maxRoundsConfigured: number;
  readonly durationSeconds: number;
  readonly totalFindingsSynthesized: number;
  readonly gateStatus: GateOverallStatus;
  readonly finalCriticDecision?: string | undefined;
  readonly rounds: readonly RoundTelemetry[];
}

export function formatOrchestratorRunBrief(params: OrchestratorRunBriefParams): string {
  const headers = [
    "Round",
    "Run ID",
    "Status",
    "Critic Decision",
    "Tasks Done",
    "Open Findings",
    "Gates",
    "Duration",
  ];
  const rows = params.rounds.map((r) => [
    `Round ${r.round}`,
    `\`${r.runId}\``,
    `\`${r.status}\``,
    `\`${r.criticDecision ?? "n/a"}\``,
    `${r.completedTaskCount}/${r.taskCount}`,
    `${r.openFindingsCount}`,
    r.gateCount === 0 ? "`not_run` (0)" : `\`${r.gateStatus}\` (${r.gateCount})`,
    `${(r.durationMs / 1000).toFixed(2)}s`,
  ]);

  const lines = [
    `# Autonomous Multi-Round Loop Summary: \`${params.baseRunId}\``,
    "",
    `- **Loop ID:** \`${params.loopId}\``,
    `- **Final Status:** \`${params.finalStatus}\``,
    `- **Total Rounds Executed:** ${params.totalRoundsExecuted} / ${params.maxRoundsConfigured}`,
    `- **Overall Duration:** ${params.durationSeconds.toFixed(2)}s`,
    `- **Total Synthesized Findings:** ${params.totalFindingsSynthesized}`,
    gateStatusLine(params.gateStatus),
    `- **Final Critic Decision:** \`${params.finalCriticDecision ?? "none"}\``,
    "",
    "## Round Execution Breakdown",
    "",
    ...formatTable(headers, rows),
    "",
  ];
  return enforceLineLimit(lines.join("\n"), 50);
}
