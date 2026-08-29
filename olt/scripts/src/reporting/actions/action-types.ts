import { dirname, join } from "node:path";
import { placeholder, registryArgv } from "./registry-argv.ts";

export interface TaskView {
  id: string;
  status: string;
  requirement_ids: string[];
  owner: string | null;
  role: string | null;
  attempt: number | null;
  repair_assignee: string | null;
  original_implementer: string | null;
  gate_results: { gate_id: string; command_id: string }[];
  validation: { validator_id: string; attempt: number; domain: string }[];
  open_finding_ids: string[];
  probe_round: number;
}

export interface GateView {
  id: string;
  scope: "run" | "task";
  cwd: string;
  command: string | string[];
  requirement_ids: string[];
  mandatory: boolean;
}

export interface CommandView {
  id: string;
  actor: string;
  status: string;
  task_id: string | null;
  gate_id: string | null;
}

export interface BranchSubTaskView {
  id: string;
  label: string;
  status: string;
  agent_id: string | null;
}

export interface BranchView {
  id: string;
  parent_task_id: string;
  parent_agent_id: string;
  status: string;
  reason: string;
  sub_tasks: BranchSubTaskView[];
}

export interface NextActions {
  argv: string[][];
  unavailable: string[];
}

export function mergeActions(...parts: readonly NextActions[]): NextActions {
  return {
    argv: parts.flatMap(({ argv }) => argv),
    unavailable: parts.flatMap(({ unavailable }) => unavailable),
  };
}

export const LEASE_TOKEN = placeholder("lease-token-returned-by:task:claim");
import { resolve } from "node:path";
import { HarnessError } from "../core/errors/index.ts";
import { findRepoRoot, stripCapsulePath } from "../core/shared/paths.ts";

export const VALIDATION_TOKEN = placeholder("validation-token-returned-by:task:validate-start");
export const CRITIC_TOKEN = placeholder("critic-token-returned-by:critic:start");
export const SUB_TASK_TOKEN = placeholder("sub-task-token-returned-by:branch:claim");

export function repositoryOf(runRoot: string): string {
  try {
    return findRepoRoot(runRoot);
  } catch (error) {
    if (error instanceof HarnessError && error.code === "PATH_SAFETY") {
      return stripCapsulePath(runRoot) ?? resolve(runRoot);
    }
    throw error;
  }
}

export function gateArgv(
  entrypoint: string,
  runRoot: string,
  gate: GateView,
  actor: string,
  taskId?: string,
): string[] | undefined {
  const repository = repositoryOf(runRoot);
  const command = Array.isArray(gate.command) ? gate.command : [gate.command];
  return registryArgv(
    entrypoint,
    "run:exec",
    [
      ["run", runRoot],
      ["actor", actor],
      ["cwd", gate.cwd === "." ? repository : join(repository, gate.cwd)],
      ...(taskId === undefined ? [] : [["task", taskId] as const]),
      ["gate", gate.id],
    ],
    command,
  );
}
