import { workflowPort } from "../../integration/index.ts";
import { abandonAttempt } from "../../workflow/lease/index.ts";
import { systemClock } from "../../workflow/index.ts";
import { enforceLineLimit } from "../formatters/index.ts";
import { textFlag, type Flags } from "../index.ts";

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
