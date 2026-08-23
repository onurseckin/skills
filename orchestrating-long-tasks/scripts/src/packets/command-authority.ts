import { existsSync } from "node:fs";
import { join } from "node:path";
import type { RunState } from "../contracts/capsule.ts";
import {
  isCognitiveValidatorRole,
  isMechanicValidatorRole,
  type AgentRole,
} from "../contracts/packets.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { loadRun } from "../store/index.ts";
import { readAgentLedger } from "../workflow/agents/ledger.ts";
import type { Flags } from "../cli/options.ts";
import type { CommandSpec } from "../cli/registry/types.ts";
import { loadRoleContract, resolveRoleContractPath } from "./role-contract.ts";

export { isCognitiveValidatorRole, isMechanicValidatorRole };

export const EXECUTION_COMMANDS: ReadonlySet<string> = new Set(["run:exec"]);

export const PROHIBITED_COGNITIVE_TOOL_CATEGORIES: ReadonlySet<string> = new Set([
  "shell",
  "test-runner",
  "build",
  "package-manager",
]);

export function isExecutionCommand(spec: CommandSpec): boolean {
  return [spec.name, ...spec.aliases].some((name) => EXECUTION_COMMANDS.has(name));
}

export function isExecutionToolCategory(category: string): boolean {
  return PROHIBITED_COGNITIVE_TOOL_CATEGORIES.has(category.toLowerCase().trim());
}

const ACTING_FLAGS: readonly string[] = ["agent", "validator", "critic", "actor"];

const SUBJECT_FLAGS: ReadonlyMap<string, string> = new Map([
  ["agent:register", "agent"],
  ["agent:report", "agent"],
  ["agent:release", "agent"],
  ["queue:pop", "agent"],
  ["critic:start", "critic"],
  ["coordinator:pushback", "validator"],
]);

function identity(flags: Flags, name: string): string | undefined {
  const value = Object.hasOwn(flags, name) ? flags[name] : undefined;
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function subjectFlag(spec: CommandSpec): string | undefined {
  for (const invocation of [spec.name, ...spec.aliases]) {
    const subject = SUBJECT_FLAGS.get(invocation);
    if (subject !== undefined) return subject;
  }
  return undefined;
}

function actingAgent(spec: CommandSpec, flags: Flags): string | undefined {
  const subject = subjectFlag(spec);
  const candidates =
    subject === undefined ? ACTING_FLAGS : ACTING_FLAGS.filter((name) => name !== subject);
  for (const name of candidates) {
    const value = identity(flags, name);
    if (value !== undefined) return value;
  }
  return undefined;
}

function capsuleState(runRoot: string): RunState | undefined {
  if (!existsSync(join(runRoot, "state.json"))) return undefined;
  try {
    return loadRun(runRoot).state;
  } catch {
    return undefined;
  }
}

export function assertRoleMayInvoke(role: AgentRole, spec: CommandSpec, agentId: string): void {
  const contract = loadRoleContract(role);
  const invocations = [spec.name, ...spec.aliases];

  if (
    isExecutionCommand(spec) &&
    isCognitiveValidatorRole(role) &&
    !isMechanicValidatorRole(role)
  ) {
    throw new HarnessError(
      "INVALID_STATE",
      `role ${role} may not invoke ${spec.name}: cognitive validators are strictly banned from executing bash/shell commands or running test suites (run:exec); agent ${agentId} holds a ${role} grant, and the contract at ${resolveRoleContractPath(role)} grants only ${contract.commands.join(", ")}`,
    );
  }

  if (invocations.some((invocation) => contract.commands.includes(invocation))) return;
  throw new HarnessError(
    "INVALID_STATE",
    `role ${role} may not invoke ${spec.name}: agent ${agentId} holds a ${role} grant, and the contract at ${resolveRoleContractPath(role)} grants only ${contract.commands.join(", ")}`,
  );
}

export function assertGrantedCommand(spec: CommandSpec, flags: Flags): void {
  const runRoot = identity(flags, "run");
  if (runRoot === undefined) return;
  const agentId = actingAgent(spec, flags);
  if (agentId === undefined) return;
  const state = capsuleState(runRoot);
  if (state === undefined) return;
  const grant = readAgentLedger(state).find((entry) => entry.id === agentId);
  if (!grant) return;

  const toolCat = identity(flags, "tool-category");
  if (
    toolCat &&
    isExecutionToolCategory(toolCat) &&
    isCognitiveValidatorRole(grant.role) &&
    !isMechanicValidatorRole(grant.role)
  ) {
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `role ${grant.role} may not invoke execution tool category '${toolCat}': agent ${agentId} is a cognitive validator, and shell/execution tools belong exclusively to mechanic validators`,
    );
  }

  assertRoleMayInvoke(grant.role, spec, agentId);
}
