import { HarnessError } from "../../errors/harness-error.ts";
import { embeddedCommandIssues } from "../../runner/command-shape.ts";
import { applicableGates, commandMatchesGate } from "../gates/gate-policy.ts";
import type { CommandProof, WorkflowState } from "../types.ts";

export function assertValidatorCommands(
  state: WorkflowState,
  taskId: string,
  validatorId: string,
  proofs: CommandProof[],
  field: string,
  requireAllGates = false,
): void {
  const task = state.tasks[taskId];
  const gates = task ? applicableGates(state, task) : [];
  const covered = new Set<string>();
  for (const proof of proofs) {
    const command = state.commands[proof.command_id];
    const matching = command ? gates.filter((gate) => commandMatchesGate(command, gate)) : [];
    if (
      !command ||
      command.status !== "succeeded" ||
      command.exit_code !== 0 ||
      command.task_id !== taskId ||
      (command.actor !== validatorId &&
        command.actor !== task?.original_implementer &&
        !task?.attempts?.some((a) => a.agent_id === command.actor)) ||
      embeddedCommandIssues(command).length > 0 ||
      (requireAllGates && gates.length > 0 && matching.length === 0)
    ) {
      throw new HarnessError(
        "INVALID_STATE",
        `${field} command ${proof.command_id} is not successful validator evidence for ${taskId}`,
      );
    }
    for (const gate of matching) covered.add(gate.id);
  }
  if (requireAllGates) {
    const missing = gates.filter((gate) => !covered.has(gate.id)).map((gate) => gate.id);
    if (missing.length > 0) {
      throw new HarnessError(
        "INVALID_STATE",
        `${field} does not cover mandatory task gates: ${missing.join(", ")}`,
      );
    }
  }
}
