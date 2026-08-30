import type { CommandRecord } from "../../core/contracts/index.ts";
import { embeddedCommandIssues } from "../../engine/runner/models/command/index.ts";
import { commandMatchesGate, workflowGates } from "../gates/gate-policy.ts";
import type { WorkflowState } from "../types.ts";

export function authoritativeRepositoryCommand(
  state: WorkflowState,
  id: string,
): CommandRecord | undefined {
  const command = state.commands[id];
  if (
    !command ||
    command.status !== "succeeded" ||
    command.exit_code !== 0 ||
    command.task_id !== null ||
    typeof command.evidence_error === "string" ||
    embeddedCommandIssues(command).length > 0
  )
    return undefined;
  if (command.gate_id === null) return command;
  const gates = workflowGates(state);
  const gate = gates.find(
    (candidate) => candidate.id === command.gate_id && candidate.scope === "run",
  );
  return gate && commandMatchesGate(command, gate) ? command : undefined;
}
