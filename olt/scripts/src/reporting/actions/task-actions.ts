import {
  gateArgv,
  type CommandView,
  type GateView,
  type NextActions,
  type TaskView,
} from "./action-types.ts";
import { leasedActions, validationActions } from "./active-actions.ts";
import { placeholder, pushArgv, registryArgv } from "./registry-argv.ts";

function claimArgv(
  entrypoint: string,
  runRoot: string,
  task: TaskView,
  role: string,
  agent: string,
): string[] | undefined {
  return registryArgv(entrypoint, "task:claim", [
    ["run", runRoot],
    ["task", task.id],
    ["agent", agent],
    ["role", role],
  ]);
}

function outstandingGateRuns(
  entrypoint: string,
  runRoot: string,
  task: TaskView,
  gates: GateView[],
  records: CommandView[],
  actor: string,
): string[][] {
  const requirementIds = new Set(task.requirement_ids);
  const argv: string[][] = [];
  for (const gate of gates) {
    if (gate.scope !== "task") continue;
    if (!gate.mandatory) continue;
    if (!gate.requirement_ids.some((id) => requirementIds.has(id))) continue;
    const green = records.some(
      (record) =>
        record.status === "succeeded" && record.task_id === task.id && record.gate_id === gate.id,
    );
    if (green) continue;
    pushArgv(argv, gateArgv(entrypoint, runRoot, gate, actor, task.id));
  }
  return argv;
}

export function taskActions(
  entrypoint: string,
  runRoot: string,
  task: TaskView,
  gates: GateView[],
  records: CommandView[],
  minProbes: number,
): NextActions {
  const argv: string[][] = [];
  const unavailable: string[] = [];
  if (task.status === "ready" || task.status === "retry_ready") {
    const agent = task.original_implementer ?? placeholder(`implementer-for:${task.id}`);
    pushArgv(argv, claimArgv(entrypoint, runRoot, task, "implementer", agent));
  }
  if (task.status === "changes_requested") {
    const agent = task.repair_assignee ?? placeholder(`repairer-for:${task.id}`);
    pushArgv(argv, claimArgv(entrypoint, runRoot, task, "repairer", agent));
  }
  if ((task.status === "leased" || task.status === "running") && task.owner && task.role) {
    argv.push(...leasedActions(entrypoint, runRoot, task));
  }
  if (task.status === "submitted") {
    pushArgv(
      argv,
      registryArgv(entrypoint, "task:validate-start", [
        ["run", runRoot],
        ["task", task.id],
        ["validator", placeholder(`fresh-validator-for:${task.id}`)],
      ]),
    );
  }
  if (task.status === "validating" && task.validation.length > 0) {
    argv.push(
      ...outstandingGateRuns(
        entrypoint,
        runRoot,
        task,
        gates,
        records,
        task.validation[0]!.validator_id,
      ),
    );
    for (const validation of task.validation) {
      argv.push(
        ...validationActions(entrypoint, runRoot, task, minProbes, validation.validator_id),
      );
    }
  }
  if (task.status === "validated" || task.status === "gating") {
    unavailable.push(
      `task ${task.id} is ${task.status}: that step runs inside task:review, and no CLI command resumes it from here`,
    );
  }
  if (task.status === "escalated") {
    pushArgv(argv, registryArgv(entrypoint, "plan:replan", [["run", runRoot]]));
  }
  return { argv, unavailable };
}
