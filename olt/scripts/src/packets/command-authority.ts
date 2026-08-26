import { existsSync } from "node:fs";
import { join } from "node:path";
import type { RunState } from "../core/contracts/capsule.ts";
import type { AgentRole } from "../core/contracts/packets.ts";
import { HarnessError } from "../core/errors/harness-error.ts";
import { loadRun } from "../engine/store/index.ts";
import { readAgentLedger } from "../workflow/agents/ledger.ts";
import type { Flags } from "../cli/options.ts";
import type { CommandSpec } from "../cli/registry/types.ts";
import { loadRoleContract, resolveRoleContractPath, type RoleContract } from "./role-contract.ts";
import {
  declaresRunIdentityFlag,
  isGrantBootstrapExempt,
  requiresActingIdentity,
} from "./grant-bootstrap-allowlist.ts";

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

export const BRANCH_WORKER_ROLES: ReadonlySet<string> = new Set([
  "sub-implementer",
  "sub-investigator",
  "sub-validator",
]);

export function isBranchWorkerSpawn(parentRole: string, childRole: string): boolean {
  return roleToTier(parentRole) === 3 && BRANCH_WORKER_ROLES.has(childRole);
}

function assertDeclaredSpawnAllowed(
  parentRole: AgentRole,
  childRole: string,
  parentAgentId?: string,
  childAgentId?: string,
): void {
  if (roleToTier(parentRole) === 3) return;
  const parentDisplay = parentAgentId ? `'${parentAgentId}' (${parentRole})` : `'${parentRole}'`;
  const childDisplay = childAgentId ? `'${childAgentId}' (${childRole})` : `'${childRole}'`;
  let contract: RoleContract;
  try {
    contract = loadRoleContract(parentRole);
  } catch (error) {
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `Declared spawn allowlist could not be verified: the role contract for supervisor ${parentDisplay} at ${resolveRoleContractPath(parentRole)} could not be loaded (${String(error)}); dispatch of subagent ${childDisplay} is refused, because an unreadable or unparseable role contract does not waive the declared-spawn allowlist`,
    );
  }
  if (contract.spawns.some((declared) => declared === childRole)) return;
  throw new HarnessError(
    "ROLE_CONFINEMENT_VIOLATION",
    `Declared spawn allowlist violation: supervisor ${parentDisplay} may not dispatch subagent ${childDisplay}; the role contract at ${resolveRoleContractPath(parentRole)} restricts spawns to [${contract.spawns.join(", ")}], and '${childRole}' is not declared among them.`,
  );
}

export function assertSpawnAuthorized(
  parentRole: AgentRole,
  childRole: string,
  parentAgentId?: string,
  childAgentId?: string,
): void {
  if (isBranchWorkerSpawn(parentRole, childRole)) return;
  assertHierarchicalSpawning(parentRole, childRole, parentAgentId, childAgentId);
  assertDeclaredSpawnAllowed(parentRole, childRole, parentAgentId, childAgentId);
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

const SUBJECT_DOUBLES_AS_ACTOR_EXEMPT_COMMANDS: ReadonlySet<string> = new Set(["agent:register"]);

function actingAgent(spec: CommandSpec, flags: Flags): string | undefined {
  const subject = subjectFlag(spec);
  const candidates =
    subject === undefined ? ACTING_FLAGS : ACTING_FLAGS.filter((name) => name !== subject);
  for (const name of candidates) {
    const value = identity(flags, name);
    if (value !== undefined) return value;
  }
  if (subject !== undefined && !SUBJECT_DOUBLES_AS_ACTOR_EXEMPT_COMMANDS.has(spec.name)) {
    const subjectValue = identity(flags, subject);
    if (subjectValue !== undefined) return subjectValue;
  }
  return undefined;
}

const SELF_SERVICE_SUBJECT_COMMANDS: ReadonlySet<string> = new Set([
  "agent:report",
  "agent:release",
]);

const GRANT_REQUIRED_ROLE_CONTRACT_EXEMPT_COMMANDS: ReadonlySet<string> = new Set([
  "recover",
  "doctor:repair",
  "worktree:reclaim",
  "orphan:dispose",
  "authority:decide",
  "run:complete",
]);

function actsOnOwnGrant(spec: CommandSpec, flags: Flags): boolean {
  if (!SELF_SERVICE_SUBJECT_COMMANDS.has(spec.name)) return false;
  const subject = subjectFlag(spec);
  if (subject === undefined || identity(flags, subject) === undefined) return false;
  return ACTING_FLAGS.filter((name) => name !== subject).every(
    (name) => identity(flags, name) === undefined,
  );
}

const RUN_SCOPED_GRANT_BOOTSTRAP_EXEMPT_COMMANDS: ReadonlySet<string> = new Set([
  "orchestrator:run",
]);

function isBootstrapExempt(spec: CommandSpec): boolean {
  return isGrantBootstrapExempt(spec) || RUN_SCOPED_GRANT_BOOTSTRAP_EXEMPT_COMMANDS.has(spec.name);
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
      grantDetail = "";
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

function assertAgentRegisterHierarchy(
  flags: Flags,
  runRoot: string,
  agentId: string | undefined,
): void {
  const childRole = identity(flags, "role");
  if (childRole === undefined) return;
  const parentAgentId = identity(flags, "parent-agent");
  const childAgentId = identity(flags, "agent");
  const state = capsuleState(runRoot);
  const ledger = state === undefined ? [] : readAgentLedger(state);

  if (parentAgentId !== undefined) {
    const parentGrant = ledger.find((entry) => entry.id === parentAgentId);
    if (!parentGrant) {
      throw new HarnessError(
        "INVALID_STATE",
        `--parent-agent ${parentAgentId} does not resolve to any grant in this run; an unresolvable parent cannot supervise agent:register`,
      );
    }
    if (parentGrant.status !== "active") {
      throw new HarnessError(
        "INVALID_STATE",
        `parent agent ${parentAgentId} holds a ${parentGrant.status} grant, not an active one, and cannot supervise agent:register`,
      );
    }
    if (agentId === undefined || agentId !== parentAgentId) {
      throw new HarnessError(
        "AUTHENTICATION_FAILURE",
        agentId === undefined
          ? `agent:register with --parent-agent '${parentAgentId}' carries no resolvable acting identity (--actor/--agent/--validator/--critic); registering under a named parent means claiming that parent's spawn authority, and an absent identity cannot prove that claim, so it is refused rather than passed`
          : `acting identity '${agentId}' does not match --parent-agent '${parentAgentId}'; agent:register may only be invoked by the parent agent itself, on its own behalf, not by naming an unrelated agent's grant as the parent to borrow its spawn authority`,
      );
    }
    assertSpawnAuthorized(parentGrant.role, childRole, parentAgentId, childAgentId);
    return;
  }

  const genesis = ledger.length === 0;
  if (genesis) return;

  const childTier = roleToTier(childRole);
  if (childTier > 1) {
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `Hierarchical supervision violation: Role '${childRole}' (Tier ${childTier}) cannot be dispatched without a supervising parent agent. Tier 2 Coordinators must be spawned by Tier 1 Orchestrators, and Tier 3 workers must be spawned by Tier 2 Coordinators.`,
    );
  }

  if (agentId === undefined) {
    throw new HarnessError(
      "INVALID_STATE",
      `agent:register carries no resolvable acting identity (--actor/--validator/--critic) and the run's agent ledger already holds an active grant; registering an unparented Tier ${childTier} agent as root is only legitimate on an empty ledger`,
    );
  }
  const actingGrant = ledger.find((entry) => entry.id === agentId && entry.status === "active");
  if (!actingGrant) {
    throw new HarnessError(
      "INVALID_STATE",
      `acting agent ${agentId} holds no active grant in this run, and the agent ledger already holds other active grants; it cannot register an unparented (root) agent`,
    );
  }
  assertSpawnAuthorized(actingGrant.role, childRole, agentId, childAgentId);
}

export function assertGrantedCommand(spec: CommandSpec, flags: Flags): void {
  if (!requiresActingIdentity(spec)) return;

  const runRoot = identity(flags, "run");
  if (runRoot === undefined) {
    if (!declaresRunIdentityFlag(spec)) return;
    if (isBootstrapExempt(spec)) return;
    throw new HarnessError(
      "INVALID_STATE",
      `${spec.name} carries no resolvable --run and is not on the grant bootstrap allowlist; a capsule root is required before its grant authority can be checked`,
    );
  }
  const agentId = actingAgent(spec, flags);

  if (spec.name === "agent:register") {
    assertAgentRegisterHierarchy(flags, runRoot, agentId);
  }

  if (agentId === undefined) {
    if (isBootstrapExempt(spec)) return;
    throw new HarnessError(
      "INVALID_STATE",
      `${spec.name} carries no resolvable acting identity (--agent/--validator/--critic/--actor) and is not on the grant bootstrap allowlist; an acting agent is required before its grant authority can be checked`,
    );
  }
  const state = capsuleState(runRoot);
  if (state === undefined) {
    if (isBootstrapExempt(spec)) return;
    throw new HarnessError(
      "INVALID_STATE",
      `${spec.name} could not load capsule state at --run ${runRoot} and is not on the grant bootstrap allowlist; an unreadable capsule cannot be treated as one with no grants`,
    );
  }
  const ledger = readAgentLedger(state);
  const rawGrant = ledger.find((entry) => entry.id === agentId);
  if (rawGrant && rawGrant.status !== "active") {
    throw new HarnessError(
      "INVALID_STATE",
      `agent ${agentId} holds a ${rawGrant.status} grant, not an active one, and may not invoke ${spec.name}`,
    );
  }
  const grant = rawGrant;
  if (!grant) {
    if (isBootstrapExempt(spec)) return;
    throw new HarnessError(
      "INVALID_STATE",
      `agent ${agentId} holds no grant in the capsule at --run ${runRoot} and ${spec.name} is not on the grant bootstrap allowlist`,
    );
  }

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

  if (spec.name === "agent:register") {
    const childRole = identity(flags, "role");
    const parentAgentId = identity(flags, "parent-agent");

    if (childRole !== undefined && parentAgentId === undefined) {
      const childTier = roleToTier(childRole);
      if (childTier > 1) {
        throw new HarnessError(
          "ROLE_CONFINEMENT_VIOLATION",
          `Hierarchical supervision violation: Role '${childRole}' (Tier ${childTier}) cannot be dispatched without a supervising parent agent. Tier 2 Coordinators must be spawned by Tier 1 Orchestrators, and Tier 3 workers must be spawned by Tier 2 Coordinators.`,
        );
      }
    }
  }

  if (actsOnOwnGrant(spec, flags)) return;
  if (GRANT_REQUIRED_ROLE_CONTRACT_EXEMPT_COMMANDS.has(spec.name)) return;
  assertRoleMayInvoke(grant.role, spec, agentId);
}
