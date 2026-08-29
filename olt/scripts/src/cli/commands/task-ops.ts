import {
  taskSubmitCommand as coreSubmit,
  taskClaimCommand,
  taskHeartbeatCommand,
} from "./task-claim.ts";
import { taskAbandonCommand } from "./task-abandon.ts";
import { taskAssignRepairerCommand } from "./task-assign-repairer.ts";
import { taskProbeCommand } from "./task-probe.ts";
import { taskRejectCommand } from "./task-reject.ts";
import { taskReviewCommand } from "./task-review.ts";
import { taskValidateStartCommand } from "./task-validation-start.ts";
import { taskReleaseCommand as coreRelease } from "./diagnostics-ops.ts";
import { loadRun } from "../../engine/store/index.ts";
import { writeIndex } from "../../engine/store/index.ts";
import { textFlag, type Flags, type CommandContext } from "../options.ts";

export {
  taskClaimCommand,
  taskHeartbeatCommand,
  taskAbandonCommand,
  taskAssignRepairerCommand,
  taskProbeCommand,
  taskRejectCommand,
  taskReviewCommand,
  taskValidateStartCommand,
};

export async function taskSubmitCommand(
  flags: Flags,
  context: CommandContext = {},
): Promise<Record<string, unknown>> {
  const result = await coreSubmit(flags, context);
  const run = textFlag(flags, "run");
  if (run) {
    const loaded = loadRun(run);
    writeIndex(run, loaded.state);
  }
  return result;
}

export function taskReleaseCommand(flags: Flags): Record<string, unknown> {
  const result = coreRelease(flags);
  const run = textFlag(flags, "run");
  if (run) {
    const loaded = loadRun(run);
    writeIndex(run, loaded.state);
  }
  return result;
}
