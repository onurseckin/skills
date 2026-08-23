import { HarnessError } from "../../core/errors/harness-error.ts";
import { gateControlBindingScopeIssues } from "../../engine/runner/gate-path-overlap.ts";
import { taskIn, transition } from "../task-state.ts";
import { systemClock, type Clock, type TransactionPort } from "../types.ts";
import { applicableGates, commandMatchesGate } from "./gate-policy.ts";

export function attachGateResult(
  port: TransactionPort,
  taskId: string,
  gateId: string,
  commandId: string,
  actor: string,
  clock: Clock = systemClock,
) {
  const now = clock.now();
  return port.transact(
    actor,
    "gate-attached",
    { task_id: taskId, gate_id: gateId, command_id: commandId },
    (draft) => {
      const task = taskIn(draft, taskId);
      if (task.status !== "validated" && task.status !== "gating") {
        throw new HarnessError("INVALID_STATE", "task must be validated before gating");
      }
      const gate = applicableGates(draft, task).find((candidate) => candidate.id === gateId);
      if (!gate) throw new HarnessError("INVALID_ARGUMENT", "gate is not mandatory and applicable");
      const command = draft.commands[commandId];
      const scopeIssues = command
        ? gateControlBindingScopeIssues(
            command.path_bindings ?? [],
            Object.values(draft.tasks).map((candidate) => candidate.write_scope),
          )
        : [];
      if (
        !command ||
        command.status !== "succeeded" ||
        command.exit_code !== 0 ||
        command.task_id !== taskId ||
        command.gate_id !== gateId ||
        !commandMatchesGate(command, gate) ||
        scopeIssues.length > 0
      ) {
        throw new HarnessError("INVALID_STATE", "command does not prove the gate contract");
      }
      task.gate_results ??= [];
      const existing = task.gate_results.find((result) => result.gate_id === gateId);
      if (existing && existing.command_id !== commandId) {
        throw new HarnessError("INVALID_STATE", "gate result cannot be overwritten");
      }
      if (!existing)
        task.gate_results.push({ gate_id: gateId, command_id: commandId, status: "passed" });
      if (task.status === "validated")
        transition(task, "gating", actor, now, "mandatory gate attached");
    },
  );
}
