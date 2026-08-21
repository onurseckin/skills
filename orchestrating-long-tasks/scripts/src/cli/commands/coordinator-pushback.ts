import { workflowPort } from "../../integration/store-ports.ts";
import { loadRun } from "../../store/index.ts";
import { recordCoordinatorPushback } from "../../workflow/review/coordinator-pushback.ts";
import { systemClock } from "../../workflow/types.ts";
import { actorFlag, textFlag, type Flags } from "../options.ts";

export function coordinatorPushbackCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const taskId = textFlag(flags, "task")!;
  const actor = actorFlag(flags);
  const validatorId = textFlag(flags, "validator")!;
  const domain = textFlag(flags, "domain")!;
  const cause = textFlag(flags, "cause")!;
  const observation = textFlag(flags, "observation")!;
  const remediation = textFlag(flags, "remediation")!;

  loadRun(run);
  const state = recordCoordinatorPushback(
    workflowPort(run),
    taskId,
    actor,
    {
      validator_id: validatorId,
      domain,
      cause,
      observation,
      remediation,
    },
    systemClock,
  );

  const task = state.tasks[taskId]!;
  const pushbacks = Array.isArray(task.coordinator_pushbacks) ? task.coordinator_pushbacks : [];
  const pushback = pushbacks.at(-1) as Record<string, unknown> | undefined;
  const markdown = [
    `### Coordinator Pushback Recorded: ${taskId}`,
    `- **Cause**: ${cause}`,
    `- **Against**: validator \`${validatorId}\`, domain \`${domain}\``,
    `- **Task status**: ${task.status}`,
    pushback ? `- **Finding id**: \`${String(pushback.id)}\`` : undefined,
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");

  return {
    markdown,
    run_root: run,
    task_id: taskId,
    task,
    coordinator_pushback: pushback,
  };
}
