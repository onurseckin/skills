import { existsSync } from "node:fs";
import { join } from "node:path";
import type { RunState } from "../core/contracts/capsule.ts";
import type { AgentRole } from "../core/contracts/packets.ts";
import { HarnessError } from "../core/errors/harness-error.ts";
import { loadRun } from "../engine/store/index.ts";
import { readAgentLedger } from "../workflow/agents/ledger.ts";
import type { Flags } from "../cli/options.ts";
import type { CommandSpec } from "../cli/registry/types.ts";
import { loadRoleContract, resolveRoleContractPath } from "./role-contract.ts";

export function isMechanicValidatorRole(role: string): boolean {
  const normalized = role.toLowerCase().trim();
  return (
    normalized === "mechanic-validator" ||
    normalized === "ui-mechanic-validator" ||
    normalized === "mechanic_validator" ||
    normalized.startsWith("mechanic-") ||
    normalized.endsWith("-mechanic-validator")
  );
}

export function isCognitiveValidatorRole(role: string): boolean {
  const normalized = role.toLowerCase().trim();
  if (isMechanicValidatorRole(normalized)) return false;
  return (
    normalized === "validator" ||
    normalized === "ui-validator" ||
    normalized.startsWith("validator-")
  );
}

export const EXECUTION_COMMANDS: ReadonlySet<string> = new Set(["run:exec"]);

export const PROHIBITED_COGNITIVE_TOOL_CATEGORIES: ReadonlySet<string> = new Set([
  "shell",
  "test-runner",
  "build",
  "package-manager",
  "bash",
  "terminal",
  "exec",
]);

export const PROHIBITED_COGNITIVE_TOOLS: ReadonlySet<string> = new Set([
  "run_command",
  "bash",
  "sh",
  "zsh",
  "exec",
  "terminal",
  "test_runner",
  "bun_test",
  "npm_test",
]);

export function isExecutionCommand(spec: CommandSpec): boolean {
  return [spec.name, ...spec.aliases].some((name) => EXECUTION_COMMANDS.has(name));
}

export function isExecutionToolCategory(category: string): boolean {
  return PROHIBITED_COGNITIVE_TOOL_CATEGORIES.has(category.toLowerCase().trim());
}

export function isProhibitedCognitiveTool(toolName: string): boolean {
  const normalized = toolName.toLowerCase().trim();
  return (
    PROHIBITED_COGNITIVE_TOOLS.has(normalized) ||
    PROHIBITED_COGNITIVE_TOOL_CATEGORIES.has(normalized)
  );
}

export function roleToTier(role: string): number {
  const r = role.toLowerCase().trim();
  if (r === "mind" || r.startsWith("mind-") || r.includes("mind")) return 0;
  if (
    r === "orchestrator" ||
    r.startsWith("orchestrator-") ||
    r.startsWith("orch-") ||
    r.includes("orchestrator")
  ) {
    return 1;
  }
  if (
    r === "coordinator" ||
    r.startsWith("coordinator-") ||
    r.startsWith("coord-") ||
    r.includes("coordinator")
  ) {
    return 2;
  }
  return 3;
}

export interface HierarchicalSpawningCheck {
  readonly valid: boolean;
  readonly parentRole: string;
  readonly childRole: string;
  readonly parentTier: number;
  readonly childTier: number;
  readonly reason?: string;
}

export function validateHierarchicalSpawning(
  parentRole: string,
  childRole: string,
): HierarchicalSpawningCheck {
  const pTier = roleToTier(parentRole);
  const cTier = roleToTier(childRole);

  // Tier 0 Mind -> Tier 1 Orchestrator only
  if (pTier === 0) {
    if (cTier === 1) {
      return { valid: true, parentRole, childRole, parentTier: pTier, childTier: cTier };
    }
    return {
      valid: false,
      parentRole,
      childRole,
      parentTier: pTier,
      childTier: cTier,
      reason: `Tier 0 Mind (${parentRole}) may only dispatch Tier 1 Orchestrators. Dispatched child role '${childRole}' (Tier ${cTier}) breaches strict hierarchical spawning boundary.`,
    };
  }

  // Tier 1 Orchestrator -> Tier 2 Coordinator only
  if (pTier === 1) {
    if (cTier === 2) {
      return { valid: true, parentRole, childRole, parentTier: pTier, childTier: cTier };
    }
    return {
      valid: false,
      parentRole,
      childRole,
      parentTier: pTier,
      childTier: cTier,
      reason: `Tier 1 Orchestrator (${parentRole}) may only dispatch Tier 2 Coordinators. Dispatched child role '${childRole}' (Tier ${cTier}) breaches strict hierarchical spawning boundary.`,
    };
  }

  // Tier 2 Coordinator -> Tier 3 workers only
  if (pTier === 2) {
    if (cTier === 3) {
      return { valid: true, parentRole, childRole, parentTier: pTier, childTier: cTier };
    }
    return {
      valid: false,
      parentRole,
      childRole,
      parentTier: pTier,
      childTier: cTier,
      reason: `Tier 2 Coordinator (${parentRole}) may only dispatch Tier 3 workers (Implementers, Validators, Critics, Repairers). Dispatched child role '${childRole}' (Tier ${cTier}) breaches strict hierarchical spawning boundary.`,
    };
  }

  // Tier 3 Leaf workers -> cannot spawn subagents
  return {
    valid: false,
    parentRole,
    childRole,
    parentTier: pTier,
    childTier: cTier,
    reason: `Tier 3 worker (${parentRole}) is a leaf execution worker and cannot spawn child subagents ('${childRole}').`,
  };
}

export function assertHierarchicalSpawning(
  parentRole: string,
  childRole: string,
  parentAgentId?: string,
  childAgentId?: string,
): void {
  const result = validateHierarchicalSpawning(parentRole, childRole);
  if (!result.valid) {
    const parentDisplay = parentAgentId ? `'${parentAgentId}' (${parentRole})` : `'${parentRole}'`;
    const childDisplay = childAgentId ? `'${childAgentId}' (${childRole})` : `'${childRole}'`;
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `Hierarchical Parent-Child Boundary Violation: Supervisor ${parentDisplay} cannot dispatch subagent ${childDisplay}. ${result.reason}`,
    );
  }
}

export function assertCognitiveValidatorHardlock(
  role: string,
  invocationOrTool: string,
  agentId?: string,
): void {
  if (isCognitiveValidatorRole(role) && !isMechanicValidatorRole(role)) {
    const norm = invocationOrTool.toLowerCase().trim();
    if (norm === "run:exec" || isExecutionToolCategory(norm) || isProhibitedCognitiveTool(norm)) {
      const agentDisplay = agentId ? `agent ${agentId}` : `role ${role}`;
      throw new HarnessError(
        "ROLE_CONFINEMENT_VIOLATION",
        `Cognitive Validator Hard-Lock Interlock: ${agentDisplay} holds a cognitive validator/critic grant and is strictly banned from executing bash/shell commands or running test suites (${invocationOrTool}). Test execution authority belongs exclusively to mechanic validators.`,
      );
    }
  }
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
  if (
    isExecutionCommand(spec) &&
    isCognitiveValidatorRole(role) &&
    !isMechanicValidatorRole(role)
  ) {
    let grantDetail = "";
    try {
      const contract = loadRoleContract(role);
      grantDetail = `, and the contract at ${resolveRoleContractPath(role)} grants only ${contract.commands.join(", ")}`;
    } catch {
      // Role contract may be dynamic or virtual
    }
    throw new HarnessError(
      "INVALID_STATE",
      `role ${role} may not invoke ${spec.name}: cognitive validators are strictly banned from executing bash/shell commands or running test suites (run:exec); agent ${agentId} holds a ${role} grant${grantDetail}`,
    );
  }

  const contract = loadRoleContract(role);
  const invocations = [spec.name, ...spec.aliases];

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
  const ledger = readAgentLedger(state);
  const grant = ledger.find((entry) => entry.id === agentId);
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

  const toolName = identity(flags, "tool");
  if (
    toolName &&
    (PROHIBITED_COGNITIVE_TOOLS.has(toolName.toLowerCase().trim()) ||
      isExecutionToolCategory(toolName)) &&
    isCognitiveValidatorRole(grant.role) &&
    !isMechanicValidatorRole(grant.role)
  ) {
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `role ${grant.role} may not invoke execution tool '${toolName}': agent ${agentId} is a cognitive validator, and shell/execution tools belong exclusively to mechanic validators`,
    );
  }

  // Hierarchical parent-child boundary supervision on agent registration
  if (spec.name === "agent:register") {
    const childRole = identity(flags, "role");
    const parentAgentId = identity(flags, "parent-agent");
    const childAgentId = identity(flags, "agent");

    if (childRole) {
      if (parentAgentId) {
        const parentGrant = ledger.find((entry) => entry.id === parentAgentId);
        if (parentGrant) {
          assertHierarchicalSpawning(parentGrant.role, childRole, parentAgentId, childAgentId);
        }
      } else {
        const childTier = roleToTier(childRole);
        if (childTier > 1) {
          throw new HarnessError(
            "ROLE_CONFINEMENT_VIOLATION",
            `Hierarchical supervision violation: Role '${childRole}' (Tier ${childTier}) cannot be dispatched without a supervising parent agent. Tier 2 Coordinators must be spawned by Tier 1 Orchestrators, and Tier 3 workers must be spawned by Tier 2 Coordinators.`,
          );
        }
      }
    }
  }

  assertRoleMayInvoke(grant.role, spec, agentId);
}
