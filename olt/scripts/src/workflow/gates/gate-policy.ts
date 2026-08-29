import type { CommandRecord } from "../../core/contracts/index.ts";
import {
  sameTrustedHostRepositoryBinding,
  TRUSTED_HOST_ASSURANCE,
} from "../../core/contracts/index.ts";
import { isAbsolute } from "node:path";
import { canonicalCommandFingerprint } from "../../engine/runner/command-id.ts";
import { embeddedCommandIssues } from "../../engine/runner/command-shape.ts";
import { gatePathBindingIssues } from "../../engine/runner/gate-path-bindings.ts";
import type { GateRuntime, TaskRecord, WorkflowState } from "../types.ts";
import { executableTaskRequirementIds } from "../authority/execution-state.ts";

type BoundGate = GateRuntime & { cwd: string; scope: "run" | "task" };

function bound(gate: GateRuntime): BoundGate {
  return gate as BoundGate;
}

export function workflowGates(state: WorkflowState): GateRuntime[] {
  return state.gates ?? state.graph?.gates ?? [];
}

export function applicableGates(state: WorkflowState, task: TaskRecord): GateRuntime[] {
  const requirements = executableTaskRequirementIds(state, task.requirement_ids);
  const gates = workflowGates(state);
  return gates.filter(
    (gate) =>
      bound(gate).scope === "task" &&
      gate.mandatory &&
      gate.requirement_ids.some((id) => requirements.has(id)),
  );
}

export function commandArgv(command: string | string[]): string[] {
  return Array.isArray(command) ? command : [command];
}

export function commandFingerprint(canonicalCwd: string, argv: readonly string[]): string {
  return canonicalCommandFingerprint(canonicalCwd, argv);
}

export function commandMatchesGate(command: CommandRecord, gate: GateRuntime): boolean {
  const expected = bound(gate);
  return (
    command.assurance === TRUSTED_HOST_ASSURANCE &&
    command.repository_before != null &&
    command.repository_after != null &&
    sameTrustedHostRepositoryBinding(command.repository_before, command.repository_after) &&
    embeddedCommandIssues(command).length === 0 &&
    gatePathBindingIssues(
      command.repository_root,
      command.cwd,
      command.argv,
      command.path_bindings,
      command.environment?.PATH,
    ).length === 0 &&
    !isAbsolute(expected.cwd) &&
    !expected.cwd.split(/[\\/]/u).includes("..") &&
    command.cwd_relative === expected.cwd &&
    (command.gate_id === gate.id ||
      command.fingerprint === commandFingerprint(command.cwd, commandArgv(gate.command)))
  );
}

export function taskHasPassedGate(task: TaskRecord, gateId: string): boolean {
  return (task.gate_results ?? []).some(
    (result) => result.gate_id === gateId && result.status === "passed",
  );
}
