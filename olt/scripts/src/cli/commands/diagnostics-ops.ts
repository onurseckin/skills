import { HarnessError } from "../../core/errors/index.ts";
import { workflowPort } from "../../integration/index.ts";
import {
  loadRun,
  recoverProjection,
  transactionRecoveryStatus,
} from "../../engine/store/index.ts";
import { recoverStale } from "../../workflow/lease/index.ts";
import { releaseLease } from "../../workflow/lease/index.ts";
import { systemClock, type WorkflowState } from "../../workflow/index.ts";
import { enforceLineLimit } from "../formatters/index.ts";
import { nextActionsBlock, recoverNextActions } from "../formatters/index.ts";
import { integerFlag, textFlag, type Flags } from "../index.ts";

export { doctorCommand, formatDoctorBrief } from "./doctor.ts";
export { doctorVerifyCommand } from "./doctor-verify.ts";
export { healthCommand } from "./health.ts";

export function leasedSubTasks(state: WorkflowState): string[] {
  const branches = Array.isArray(state.branches) ? state.branches : [];
  return branches
    .flatMap((branch) => branch.sub_tasks)
    .filter((subTask) => subTask.lease !== undefined)
    .map((subTask) => subTask.id);
}

export function recoverCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run");
  if (run === undefined) {
    throw new HarnessError("INVALID_ARGUMENT", "Missing required --run flag for recover");
  }
  const actor = textFlag(flags, "actor");
  if (actor === undefined) {
    throw new HarnessError("INVALID_ARGUMENT", "Missing required --actor flag for recover");
  }
  const graceSeconds = integerFlag(flags, "grace-seconds", { minimum: 0, maximum: 86_400 });
  const pendingPhase = transactionRecoveryStatus(run);

  const port = workflowPort(run);
  const before = port.read();
  const leasedBefore = Object.values(before.tasks)
    .filter((task) => task.lease !== undefined)
    .map((task) => task.id);
  const subLeasedBefore = leasedSubTasks(before);
  const state = recoverStale(
    port,
    actor,
    systemClock,
    graceSeconds === undefined ? {} : { graceSeconds },
  );
  const recovered = leasedBefore.filter((id) => {
    const task = state.tasks[id];
    return task !== undefined && task.lease === undefined;
  });
  const stillSubLeased = new Set(leasedSubTasks(state));
  const recoveredSubTasks = subLeasedBefore.filter((id) => stillSubLeased.has(id) === false);

  const lines = [
    `### Stale Lease Recovery: \`${run}\``,
    `- **Actor**: ${actor}`,
    `- **Transaction Recovery**: ${pendingPhase === undefined ? "not pending" : pendingPhase}`,
    `- **Leases Released**: ${recovered.length}`,
    ...recovered.map((id) => {
      const task = state.tasks[id];
      const statusStr =
        task !== undefined && typeof task.status === "string" ? task.status : "unknown";
      return `  - \`${id}\` -> ${statusStr}`;
    }),
    `- **Branch Sub-leases Reclaimed**: ${recoveredSubTasks.length}`,
    ...recoveredSubTasks.map((id) => `  - \`${id}\` -> open`),
    ...nextActionsBlock(recoverNextActions(run)),
  ];
  return {
    markdown: enforceLineLimit(lines.join("\n")),
    run_root: run,
    recovered,
    recovered_sub_tasks: recoveredSubTasks,
    transaction_recovery_phase: pendingPhase,
    tasks: state.tasks,
  };
}

export function repairProjectionCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run");
  if (run === undefined) {
    throw new HarnessError("INVALID_ARGUMENT", "Missing required --run flag for repair projection");
  }
  const actor = textFlag(flags, "actor");
  if (actor === undefined) {
    throw new HarnessError("INVALID_ARGUMENT", "Missing required --actor flag for repair projection");
  }
  const pendingPhase = transactionRecoveryStatus(run);
  const state = recoverProjection(run, actor);
  const lastEvent = loadRun(run).events.at(-1);
  const quarantined = lastEvent !== undefined && lastEvent.payload.quarantined_torn_tail === true;
  const lines = [
    `### Projection Repaired: \`${run}\``,
    `- **Actor**: ${actor}`,
    `- **Event Sequence**: ${state.event_sequence}`,
    `- **Transaction Recovery**: ${pendingPhase === undefined ? "not pending" : pendingPhase}`,
    `- **Torn Tail Quarantined**: ${quarantined ? "yes" : "no"}`,
    ...nextActionsBlock([
      {
        command: `bun harness.ts run:status --run ${run}`,
        role: "Orchestrator",
        description: "Verify state projection integrity",
      },
    ]),
  ];
  return {
    markdown: enforceLineLimit(lines.join("\n")),
    run_root: run,
    state,
    transaction_recovery_phase: pendingPhase,
    quarantined_torn_tail: quarantined,
  };
}

export function taskReleaseCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run");
  if (run === undefined) {
    throw new HarnessError("INVALID_ARGUMENT", "Missing required --run flag for task release");
  }
  const taskId = textFlag(flags, "task");
  if (taskId === undefined) {
    throw new HarnessError("INVALID_ARGUMENT", "Missing required --task flag for task release");
  }
  const agent = textFlag(flags, "agent");
  if (agent === undefined) {
    throw new HarnessError("INVALID_ARGUMENT", "Missing required --agent flag for task release");
  }
  const token = textFlag(flags, "token");
  if (token === undefined) {
    throw new HarnessError("INVALID_ARGUMENT", "Missing required --token flag for task release");
  }
  const state = releaseLease(workflowPort(run), taskId, agent, token);
  const task = state.tasks[taskId];
  const taskStatus = task !== undefined ? task.status : "unknown";
  const lines = [
    `### Lease Released: \`${taskId}\``,
    `- **Agent**: \`${agent}\``,
    `- **Task Status**: ${taskStatus}`,
    `- **Reclaim**: \`bun harness.ts task:claim --run ${run} --task ${taskId} --agent <AGENT>\``,
    ...nextActionsBlock([
      {
        command: `bun harness.ts task:claim --run ${run} --task ${taskId} --agent <AGENT>`,
        role: "Implementer",
        description: "Reclaim released task lease",
      },
    ]),
  ];
  return { markdown: enforceLineLimit(lines.join("\n")), run_root: run, task };
}
