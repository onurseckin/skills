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
  validation: { validator_id: string; attempt: number } | null;
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

/** What a set of next actions can and cannot offer, kept together so neither half is lost. */
export interface NextActions {
  argv: string[][];
  /** A step the run needs that no registry command performs, stated instead of invented. */
  unavailable: string[];
}

export function mergeActions(...parts: readonly NextActions[]): NextActions {
  return {
    argv: parts.flatMap(({ argv }) => argv),
    unavailable: parts.flatMap(({ unavailable }) => unavailable),
  };
}

/**
 * Bearer tokens are minted once and never persisted, so the handoff can only say which command
 * hands one out. Printing anything else here would either leak a secret or invent one.
 */
export const LEASE_TOKEN = placeholder("lease-token-returned-by:task:claim");
export const VALIDATION_TOKEN = placeholder("validation-token-returned-by:task:validate-start");
export const CRITIC_TOKEN = placeholder("critic-token-returned-by:critic:start");
export const SUB_TASK_TOKEN = placeholder("sub-task-token-returned-by:branch:claim");

/** The run root is `<repo>/.capsules/<run-id>`; a gate's cwd is relative to that repository. */
export function repositoryOf(runRoot: string): string {
  return dirname(dirname(runRoot));
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
