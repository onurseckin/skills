import type { CommandRecord } from "../../contracts/commands.ts";
import { embeddedCommandIssues } from "../../runner/command-shape.ts";
import { commandMatchesGate } from "../gates/gate-policy.ts";
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
  const gates = (state.gates ?? (state as unknown as { graph?: { gates?: typeof state.gates } }).graph?.gates ?? []);
  const gate = gates.find(
    (candidate) => candidate.id === command.gate_id && candidate.scope === "run",
  );
  return gate && commandMatchesGate(command, gate) ? command : undefined;
}
