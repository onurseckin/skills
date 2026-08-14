import {
  gateCommand,
  placeholder,
  type GateView,
  type PacketView,
  type TaskView,
} from "./action-types.ts";
import { leasedActions, validationActions } from "./active-actions.ts";

export function taskActions(
  prefix: string[],
  runRoot: string,
  task: TaskView,
  gates: GateView[],
  packets: PacketView[],
): string[][] {
  const commands: string[][] = [];
  const requirementIds = new Set(
    Array.isArray((task as TaskView & { requirement_ids?: unknown }).requirement_ids)
      ? ((task as TaskView & { requirement_ids: string[] }).requirement_ids ?? [])
      : [],
  );
  if (task.status === "ready" || task.status === "retry_ready") {
    commands.push([
      ...prefix,
      "claim",
      "--run",
      runRoot,
      "--task",
      task.id,
      "--agent",
      task.original_implementer ?? placeholder(`implementer-for:${task.id}`),
      "--role",
      "implementer",
    ]);
  }
  if (task.status === "changes_requested") {
    commands.push([
      ...prefix,
      "claim",
      "--run",
      runRoot,
      "--task",
      task.id,
      "--agent",
      task.repair_assignee ?? placeholder(`repairer-for:${task.id}`),
      "--role",
      "repairer",
    ]);
  }
  if ((task.status === "leased" || task.status === "running") && task.owner && task.role) {
    commands.push(...leasedActions(prefix, runRoot, task, packets));
  }
  if (task.status === "submitted") {
    commands.push([
      ...prefix,
      "begin-validation",
      "--run",
      runRoot,
      "--task",
      task.id,
      "--validator",
      placeholder(`fresh-validator-for:${task.id}`),
    ]);
  }
  if (task.status === "validating" && task.validation) {
    commands.push(...validationActions(prefix, runRoot, task, packets));
  }
  if (task.status === "validated") {
    for (const gate of gates.filter(
      (entry) =>
        entry.scope === "task" &&
        (entry as GateView & { mandatory?: boolean }).mandatory === true &&
        entry.requirement_ids.some((id) => requirementIds.has(id)) &&
        !task.gate_results.some((result) => result.gate_id === entry.id),
    )) {
      commands.push(gateCommand(prefix, runRoot, gate, task.id));
      commands.push([
        ...prefix,
        "gate",
        "--run",
        runRoot,
        "--task",
        task.id,
        "--gate",
        gate.id,
        "--command-id",
        placeholder(`command-id-from:${gate.id}`),
        "--actor",
        "coordinator",
      ]);
    }
  }
  if (task.status === "gating") {
    commands.push([
      ...prefix,
      "finish",
      "--run",
      runRoot,
      "--task",
      task.id,
      "--actor",
      "coordinator",
    ]);
  }
  return commands;
}
