import { HarnessError } from "../../core/errors/index.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { heartbeat } from "../../workflow/lease/heartbeat.ts";
import { formatTaskHeartbeatBrief } from "../formatters/index.ts";
import { textFlag, type Flags } from "../options.ts";

export function taskHeartbeatCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const taskId = textFlag(flags, "task")!;
  const agent = textFlag(flags, "agent")!;
  const token = textFlag(flags, "token")!;

  const state = heartbeat(workflowPort(run), taskId, agent, token);
  const task = state.tasks[taskId]!;
  const lease = task.lease;
  if (!lease)
    throw new HarnessError("INTEGRITY", `heartbeat for ${taskId} left the task without a lease`);
  const markdown = formatTaskHeartbeatBrief({
    taskId,
    agent,
    extendedMinutes: Math.round(lease.duration_seconds / 60),
    newDeadline: lease.expires_at,
  });

  return { markdown, run_root: run, task };
}
