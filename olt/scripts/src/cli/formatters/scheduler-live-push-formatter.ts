import type { SchedulerLivePushReport } from "../../engine/scheduler/reporting/index.ts";
import { enforceLineLimit } from "./line-limiter.ts";

export interface SchedulerLiveChatPushBriefParams {
  readonly report: SchedulerLivePushReport;
  readonly maxLines?: number | undefined;
}

export function formatSchedulerLiveChatPushBrief(params: SchedulerLiveChatPushBriefParams): string {
  const maxLines = params.maxLines ?? 45;
  return enforceLineLimit(params.report.markdown, maxLines);
}

export function formatSchedulerLivePushStatusCard(params: {
  readonly runRoot: string;
  readonly completedTasks: number;
  readonly totalTasks: number;
  readonly leasedTasks: number;
  readonly activeWave: number | null;
  readonly totalWaves: number;
  readonly telemetryBanner: string;
  readonly diffSummary?: string | undefined;
  readonly stagnationBadge?: string | undefined;
}): string {
  const pct =
    params.totalTasks > 0 ? Math.round((params.completedTasks / params.totalTasks) * 100) : 0;
  const blocks = Math.round(pct / 10);
  const bar = `[${"█".repeat(blocks)}${"░".repeat(10 - blocks)}] ${pct}%`;

  const lines = [
    `### ⚡ Scheduler Progress: ${bar}`,
    `- **Run**: \`${params.runRoot}\``,
    `- **Status**: ${params.completedTasks}/${params.totalTasks} Tasks Done | ${params.leasedTasks} Leased | Wave ${params.activeWave ?? "Complete"}/${params.totalWaves}`,
    `- **Telemetry**: \`${params.telemetryBanner}\``,
  ];

  if (params.diffSummary) {
    lines.push(`- **Delta**: ${params.diffSummary}`);
  }
  if (params.stagnationBadge) {
    lines.push(`- **Flow**: ${params.stagnationBadge}`);
  }

  return enforceLineLimit(lines.join("\n"), 25);
}
