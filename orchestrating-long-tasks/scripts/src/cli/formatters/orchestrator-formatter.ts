import { enforceLineLimit, formatTable } from "./line-limiter.ts";
import type { LoopSummary, RoundTelemetry } from "../../orchestrator/types.ts";

export interface OrchestratorRunBriefParams {
  readonly loopId: string;
  readonly baseRunId: string;
  readonly finalStatus: string;
  readonly totalRoundsExecuted: number;
  readonly maxRoundsConfigured: number;
  readonly durationSeconds: number;
  readonly totalFindingsSynthesized: number;
  readonly allGatesPassed: boolean;
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
    "Duration",
  ];
  const rows = params.rounds.map((r) => [
    `Round ${r.round}`,
    `\`${r.runId}\``,
    `\`${r.status}\``,
    `\`${r.criticDecision ?? "n/a"}\``,
    `${r.completedTaskCount}/${r.taskCount}`,
    `${r.openFindingsCount}`,
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
    `- **All Gates Passed:** ${params.allGatesPassed ? "✅ Yes" : "❌ No"}`,
    `- **Final Critic Decision:** \`${params.finalCriticDecision ?? "none"}\``,
    "",
    "## Round Execution Breakdown",
    "",
    ...formatTable(headers, rows),
    "",
  ];
  return enforceLineLimit(lines.join("\n"), 50);
}
