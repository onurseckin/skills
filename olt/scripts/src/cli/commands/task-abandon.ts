import { workflowPort } from "../../integration/store-ports.ts";
import { abandonAttempt } from "../../workflow/lease/abandon.ts";
import { systemClock } from "../../workflow/types.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import { textFlag, type Flags } from "../options.ts";

export function taskAbandonCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const taskId = textFlag(flags, "task")!;
  const actor = textFlag(flags, "actor")!;
  const reason = textFlag(flags, "reason")!;
  const state = abandonAttempt(workflowPort(run), taskId, actor, reason, systemClock);
  const task = state.tasks[taskId]!;
  const lines = [
    `### Attempt Abandoned: \`${taskId}\``,
    `- **Actor**: ${actor}`,
    `- **Reason**: ${reason}`,
    `- **Task Status**: ${task.status}`,
  ];
  return { markdown: enforceLineLimit(lines.join("\n")), run_root: run, task };
}
