import { workflowPort } from "../../integration/store-ports.ts";
import {
  assignReplacementRepairer,
  type ReplacementReason,
} from "../../workflow/review/assign-repairer.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { formatTaskAssignRepairerBrief } from "../formatters/index.ts";
import { textFlag, type Flags } from "../options.ts";

const REASONS: readonly ReplacementReason[] = ["repeated_failure", "stale", "unavailable"];

function replacementReason(flags: Flags): ReplacementReason {
  const reason = textFlag(flags, "reason")!;
  if (!REASONS.includes(reason as ReplacementReason)) {
    throw new HarnessError("INVALID_ARGUMENT", `--reason must be one of ${REASONS.join(", ")}`);
  }
  return reason as ReplacementReason;
}

/**
 * The original implementer gets the first repair opportunity always; a replacement is only ever
 * the harness's own recorded decision, never an agent choosing its own repairer.
 */
export function taskAssignRepairerCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const taskId = textFlag(flags, "task")!;
  const actor = textFlag(flags, "actor")!;
  const replacementId = textFlag(flags, "repairer")!;
  const reason = replacementReason(flags);
  const evidence = textFlag(flags, "evidence")!;

  const state = assignReplacementRepairer(
    workflowPort(run),
    taskId,
    replacementId,
    actor,
    reason,
    evidence,
  );
  const task = state.tasks[taskId]!;
  return {
    markdown: formatTaskAssignRepairerBrief({
      taskId,
      replacementId,
      reason,
      evidence,
    }),
    run_root: run,
    task,
  };
}
