import { FORBIDDEN_VALIDATOR_COMMANDS } from "./authority.ts";
import { resolveRoleArchetype } from "./profiles.ts";
import type {
  RoleActionType,
  RoleBoundaryViolation,
  RoleCapabilityEntry,
  RoleCapabilityMatrix,
  RoleExecutionTier,
} from "./types.ts";

function makeCap(
  role: string,
  tier: RoleExecutionTier,
  profile: RoleCapabilityEntry["profile"],
  flags: { write: boolean; exec: boolean; spawn: boolean; lease: boolean },
  allowedCommands: readonly string[],
  forbiddenCommands: readonly string[],
  allowedSpawns: readonly string[],
  invariants: readonly string[],
): RoleCapabilityEntry {
  return {
    role,
    tier,
    profile,
    canWriteCode: flags.write,
    canExecuteCommands: flags.exec,
    canSpawnSubagents: flags.spawn,
    canClaimLeases: flags.lease,
    allowedCommands,
    forbiddenCommands,
    allowedSpawns,
    invariants,
  };
}

const SUP_FORBIDDEN = [
  "task:claim",
  "task:submit",
  "shell",
  "run_command",
  "edit_file",
  "write_to_file",
];

export const CANONICAL_ROLE_CAPABILITIES: RoleCapabilityMatrix = {
  mind: makeCap(
    "mind",
    0,
    "deliberate",
    { write: false, exec: true, spawn: true, lease: false },
    ["bun harness.ts *", "git status", "git diff", "git log"],
    ["run:exec", ...SUP_FORBIDDEN],
    ["orchestrator", "mind-auditor", "skill-auditor", "policy-discovery"],
    ["SUPERVISOR_ZERO_CODE_EDITS", "NO_RAW_JSONL_READS"],
  ),
  orchestrator: makeCap(
    "orchestrator",
    1,
    "deliberate",
    { write: false, exec: true, spawn: true, lease: false },
    ["bun harness.ts *"],
    SUP_FORBIDDEN,
    ["coordinator"],
    ["SUPERVISOR_ZERO_CODE_EDITS", "UNIDIRECTIONAL_DELEGATION"],
  ),
  coordinator: makeCap(
    "coordinator",
    2,
    "default",
    { write: false, exec: true, spawn: true, lease: false },
    ["bun harness.ts *"],
    SUP_FORBIDDEN,
    [
      "implementer",
      "validator",
      "repairer",
      "completeness-critic",
      "planner",
      "plan-validator",
      "validator-code-quality",
      "validator-product",
      "validator-security",
      "validator-system-design",
      "validator-ui-design",
    ],
    ["SUPERVISOR_ZERO_CODE_EDITS"],
  ),
  implementer: makeCap(
    "implementer",
    3,
    "default",
    { write: true, exec: true, spawn: true, lease: true },
    ["bun harness.ts *", "bun test *", "git diff", "git status"],
    ["authority:decide", "mind:admit", "mind:rotate"],
    ["sub-implementer", "sub-validator", "sub-investigator"],
    ["STRICT_LEASE_CONFINEMENT", "ZERO_ANY_INVARIANT", "ZERO_SUPPRESSIONS_INVARIANT"],
  ),
  validator: makeCap(
    "validator",
    3,
    "adversarial",
    { write: false, exec: false, spawn: false, lease: false },
    [],
    [...FORBIDDEN_VALIDATOR_COMMANDS],
    [],
    ["ANTI_BOUNDARY_LEAK", "COGNITIVE_HARD_LOCK", "READ_ONLY_OBSERVER"],
  ),
  "completeness-critic": makeCap(
    "completeness-critic",
    3,
    "adversarial",
    { write: false, exec: false, spawn: false, lease: false },
    [],
    [...FORBIDDEN_VALIDATOR_COMMANDS],
    [],
    ["ANTI_BOUNDARY_LEAK", "COGNITIVE_HARD_LOCK"],
  ),
  planner: makeCap(
    "planner",
    2,
    "deliberate",
    { write: false, exec: true, spawn: false, lease: false },
    ["bun harness.ts plan:*", "bun harness.ts msg:*"],
    ["edit_file", "write_to_file", "task:claim"],
    [],
    ["MANDATORY_BRAINSTORM_BEFORE_COMPILE", "SUPERVISOR_ZERO_CODE_EDITS"],
  ),
  "plan-validator": makeCap(
    "plan-validator",
    3,
    "adversarial",
    { write: false, exec: false, spawn: false, lease: false },
    [],
    [...FORBIDDEN_VALIDATOR_COMMANDS],
    [],
    ["REJECT_SHALLOW_UMBRELLA_COMPRESSION", "ANTI_BOUNDARY_LEAK"],
  ),
  repairer: makeCap(
    "repairer",
    3,
    "default",
    { write: true, exec: true, spawn: false, lease: true },
    ["bun harness.ts *", "bun test *"],
    ["authority:decide", "mind:admit"],
    [],
    ["REPAIR_LEASE_CONFINEMENT", "ZERO_ANY_INVARIANT"],
  ),
  "sub-implementer": makeCap(
    "sub-implementer",
    3,
    "default",
    { write: true, exec: true, spawn: false, lease: true },
    ["bun harness.ts *", "bun test *"],
    ["authority:decide", "mind:admit"],
    [],
    ["LEAF_WORKER_CONFINEMENT"],
  ),
  "sub-validator": makeCap(
    "sub-validator",
    3,
    "adversarial",
    { write: false, exec: false, spawn: false, lease: false },
    [],
    [...FORBIDDEN_VALIDATOR_COMMANDS],
    [],
    ["ANTI_BOUNDARY_LEAK", "COGNITIVE_HARD_LOCK"],
  ),
  "sub-investigator": makeCap(
    "sub-investigator",
    3,
    "cheap_bulk",
    { write: false, exec: false, spawn: false, lease: false },
    [],
    [...FORBIDDEN_VALIDATOR_COMMANDS],
    [],
    ["READ_ONLY_CONFINEMENT"],
  ),
  owner: makeCap(
    "owner",
    "independent",
    "deliberate",
    { write: true, exec: true, spawn: true, lease: false },
    ["bun harness.ts *", "authority:decide", "agent:register", "doctor"],
    [],
    ["mind", "orchestrator", "coordinator"],
    ["GENESIS_AUTHORITY_CONFERRAL", "FAIL_CLOSED_RBAC"],
  ),
  "independent-planner": makeCap(
    "independent-planner",
    "independent",
    "deliberate",
    { write: false, exec: false, spawn: false, lease: false },
    ["msg:send", "msg:recv", "msg:poll"],
    ["edit_file", "write_to_file", "task:claim", "run_command"],
    [],
    ["COMPLETE_HARNESS_DECOUPLING", "PURE_ENGLISH_CONCEPTUAL_STANDARD"],
  ),
};

export function getRoleCapabilities(role: string): RoleCapabilityEntry {
  const exact = CANONICAL_ROLE_CAPABILITIES[role];
  if (exact !== undefined) {
    return exact;
  }

  const archetype = resolveRoleArchetype(role);
  const isValidator =
    archetype === "adversarial" ||
    role.startsWith("validator") ||
    role.includes("critic") ||
    role.includes("auditor");
  const isSupervisor =
    archetype === "deliberate" ||
    role.includes("coord") ||
    role.includes("orchestrat") ||
    role.includes("superv");
  const isLeaf = role.startsWith("sub-");

  let tier: RoleExecutionTier = 3;
  if (role.includes("mind")) tier = 0;
  else if (role.includes("orchestrat")) tier = 1;
  else if (role.includes("coord") || role.includes("planner")) tier = 2;

  return {
    role,
    tier,
    profile: archetype,
    canWriteCode: !isValidator && !isSupervisor,
    canExecuteCommands: !isValidator,
    canSpawnSubagents: isSupervisor || (!isLeaf && !isValidator),
    canClaimLeases: !isValidator && !isSupervisor,
    allowedCommands: isValidator ? [] : ["bun harness.ts *"],
    forbiddenCommands: isValidator ? [...FORBIDDEN_VALIDATOR_COMMANDS] : [],
    allowedSpawns: [],
    invariants: isValidator
      ? ["ANTI_BOUNDARY_LEAK", "COGNITIVE_HARD_LOCK"]
      : isSupervisor
        ? ["SUPERVISOR_ZERO_CODE_EDITS"]
        : [],
  };
}

export function isCodeWritePermitted(role: string): boolean {
  return getRoleCapabilities(role).canWriteCode;
}

export function isSubagentSpawnPermitted(role: string, childRole?: string): boolean {
  const caps = getRoleCapabilities(role);
  if (!caps.canSpawnSubagents) {
    return false;
  }
  if (childRole !== undefined && caps.allowedSpawns.length > 0) {
    return caps.allowedSpawns.includes(childRole);
  }
  return true;
}

export function isCommandPermitted(role: string, command: string): boolean {
  const caps = getRoleCapabilities(role);
  if (caps.forbiddenCommands.includes(command)) {
    return false;
  }
  if (!caps.canExecuteCommands) {
    return false;
  }
  return true;
}

export function evaluateWatchdogRoleBoundary(
  role: string,
  action: RoleActionType,
  target?: string,
): { allowed: boolean; violation?: RoleBoundaryViolation } {
  const caps = getRoleCapabilities(role);

  if (action === "code_write" && !caps.canWriteCode) {
    return {
      allowed: false,
      violation: {
        role,
        action,
        target,
        ruleId: "watchdog:role-boundary:zero-code-edits",
        message: `Role '${role}' is prohibited from direct code modifications.`,
      },
    };
  }

  if (action === "subagent_spawn") {
    if (!caps.canSpawnSubagents) {
      return {
        allowed: false,
        violation: {
          role,
          action,
          target,
          ruleId: "watchdog:role-boundary:no-spawn-authority",
          message: `Role '${role}' (Tier ${caps.tier}) does not have subagent spawn authority.`,
        },
      };
    }
    if (
      target !== undefined &&
      caps.allowedSpawns.length > 0 &&
      !caps.allowedSpawns.includes(target)
    ) {
      return {
        allowed: false,
        violation: {
          role,
          action,
          target,
          ruleId: "watchdog:role-boundary:unauthorized-child-spawn",
          message: `Role '${role}' is not permitted to spawn '${target}'. Allowed spawns: [${caps.allowedSpawns.join(", ")}].`,
        },
      };
    }
  }

  if (action === "command_exec" && target !== undefined) {
    if (
      caps.forbiddenCommands.includes(target) ||
      (!caps.canExecuteCommands && FORBIDDEN_VALIDATOR_COMMANDS.has(target))
    ) {
      return {
        allowed: false,
        violation: {
          role,
          action,
          target,
          ruleId: "watchdog:role-boundary:forbidden-command",
          message: `Role '${role}' attempted to execute forbidden command '${target}'.`,
        },
      };
    }
  }

  if (action === "lease_claim" && !caps.canClaimLeases) {
    return {
      allowed: false,
      violation: {
        role,
        action,
        target,
        ruleId: "watchdog:role-boundary:lease-prohibited",
        message: `Role '${role}' is prohibited from claiming task write leases.`,
      },
    };
  }

  return { allowed: true };
}
