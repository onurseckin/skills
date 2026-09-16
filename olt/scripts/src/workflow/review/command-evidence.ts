import { HarnessError } from "../../core/errors/index.ts";
import { embeddedCommandIssues } from "../../engine/runner/models/command/index.ts";
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
    if (!command) {
      throw new HarnessError(
        "INVALID_STATE",
        `${field} command ${proof.command_id} does not exist in run state`,
      );
    }
    if (command.task_id !== taskId) {
      throw new HarnessError(
        "INVALID_STATE",
        `${field} command ${proof.command_id} belongs to task '${command.task_id}', expected '${taskId}'`,
      );
    }
    const isValidActor =
      command.actor === validatorId ||
      command.actor === task?.original_implementer ||
      (task?.attempts?.some((a) => a.agent_id === command.actor) ?? false);
    if (!isValidActor) {
      throw new HarnessError(
        "INVALID_STATE",
        `${field} command ${proof.command_id} actor '${command.actor}' is neither validator '${validatorId}' nor implementer`,
      );
    }
    if (command.status !== "succeeded") {
      throw new HarnessError(
        "INVALID_STATE",
        `${field} command ${proof.command_id} status is '${command.status}', expected 'succeeded'`,
      );
    }
    if (command.exit_code !== 0) {
      throw new HarnessError(
        "INVALID_STATE",
        `${field} command ${proof.command_id} exited with status ${command.exit_code}, expected 0`,
      );
    }
    const issues = embeddedCommandIssues(command);
    if (issues.length > 0) {
      throw new HarnessError(
        "INVALID_STATE",
        `${field} command ${proof.command_id} has embedded issues: ${issues.join("; ")}`,
      );
    }
    const matching = gates.filter((gate) => commandMatchesGate(command, gate));
    if (requireAllGates && gates.length > 0 && matching.length === 0) {
      throw new HarnessError(
        "INVALID_STATE",
        `${field} command ${proof.command_id} is not successful validator evidence for ${taskId}: does not match any applicable task gates`,
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
