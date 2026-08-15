import type { ScreenshotRecord } from "../../reporting/screenshot-types.ts";
import { enforceLineLimit } from "./line-limiter.ts";

export interface ScreenshotsListParams {
  screenshots: ScreenshotRecord[];
  count: number;
  taskId?: string | undefined;
  commandId?: string | undefined;
}

export function formatScreenshotsListBrief(params: ScreenshotsListParams): string {
  const scopeSuffix = params.taskId
    ? ` (Task: \`${params.taskId}\`)`
    : params.commandId
      ? ` (Command: \`${params.commandId}\`)`
      : "";

  const lines = [`### Run Screenshots: ${params.count} total${scopeSuffix}`];

  if (params.screenshots.length === 0) {
    lines.push("- No screenshots recorded for this run.");
  } else {
    for (const s of params.screenshots.slice(0, 15)) {
      const details: string[] = [];
      if (s.command_id) details.push(`Command: \`${s.command_id}\``);
      if (s.task_id) details.push(`Task: \`${s.task_id}\``);
      if (s.actor) details.push(`Actor: \`${s.actor}\``);
      const detailStr = details.length > 0 ? ` (${details.join(" | ")})` : "";
      lines.push(`- **\`${s.name}\`**${detailStr}: \`${s.evidence_path}\``);
    }
    if (params.screenshots.length > 15) {
      lines.push(`- ... and ${params.screenshots.length - 15} more screenshots.`);
    }
  }

  return enforceLineLimit(lines.join("\n"), 30);
}
