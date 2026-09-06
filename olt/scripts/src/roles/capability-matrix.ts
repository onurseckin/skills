import { FORBIDDEN_VALIDATOR_COMMANDS } from "./authority.ts";
import { resolveRoleArchetype } from "./profiles.ts";
import type {
  RoleActionType,
  RoleBoundaryViolation,
  RoleCapabilityEntry,
  RoleCapabilityMatrix,
  RoleExecutionTier,
} from "./types.ts";

const SUP_FORBIDDEN = [
  "task:claim",
  "task:submit",
  "shell",
  "run_command",
  "edit_file",
  "write_to_file",
];

const COORD_SPAWNS = [
  "implementer",
  "validator",
  "publisher",
  "completeness-critic",
  "planner",
  "plan-validator",
  "validator-code-quality",
  "validator-product",
  "validator-security",
  "validator-system-design",
  "validator-ui-design",
];

const PUB_CMDS = [
  "worktree:land",
  "worktree:clean",
  "worktree:status",
  "task:check",
  "doctor",
  "whoami",
  "msg:send",
  "msg:recv",
];

const mk = (
  role: string,
  tier: RoleExecutionTier,
  profile: RoleCapabilityEntry["profile"],
  flags: string,
  allowedCommands: readonly string[],
  forbiddenCommands: readonly string[],
  allowedSpawns: readonly string[],
  invariants: readonly string[],
): [string, RoleCapabilityEntry] => [
  role,
  {
    role,
    tier,
    profile,
    canWriteCode: flags.includes("w"),
    canExecuteCommands: flags.includes("x"),
    canSpawnSubagents: flags.includes("s"),
    canClaimLeases: flags.includes("l"),
    allowedCommands,
    forbiddenCommands,
    allowedSpawns,
    invariants,
  },
];

const mkVal = (
  role: string,
  invariants: readonly string[],
  profile: RoleCapabilityEntry["profile"] = "adversarial",
): [string, RoleCapabilityEntry] => [
  role,
  {
    role,
    tier: 3,
    profile,
    canWriteCode: false,
    canExecuteCommands: false,
    canSpawnSubagents: false,
    canClaimLeases: false,
    allowedCommands: [],
    forbiddenCommands: [...FORBIDDEN_VALIDATOR_COMMANDS],
    allowedSpawns: [],
    invariants,
  },
];

export const CANONICAL_ROLE_CAPABILITIES: RoleCapabilityMatrix = Object.fromEntries([
  mk(
    "mind",
    0,
    "deliberate",
    "xs",
    ["bun harness.ts *", "git status", "git diff", "git log"],
    ["run:exec", ...SUP_FORBIDDEN],
    ["orchestrator", "mind-auditor", "skill-auditor"],
    ["SUPERVISOR_ZERO_CODE_EDITS", "NO_RAW_JSONL_READS"],
  ),
  mk(
    "orchestrator",
    1,
    "deliberate",
    "xs",
    ["bun harness.ts *"],
    SUP_FORBIDDEN,
    ["coordinator"],
    ["SUPERVISOR_ZERO_CODE_EDITS", "UNIDIRECTIONAL_DELEGATION"],
  ),
  mk("coordinator", 2, "default", "xs", ["bun harness.ts *"], SUP_FORBIDDEN, COORD_SPAWNS, [
    "SUPERVISOR_ZERO_CODE_EDITS",
  ]),
  mk(
    "implementer",
    3,
    "default",
    "wxsl",
    ["bun harness.ts *", "bun test *", "git diff", "git status"],
    ["authority:decide", "mind:admit", "mind:rotate"],
    ["sub-implementer", "sub-validator", "sub-investigator"],
    ["STRICT_LEASE_CONFINEMENT", "ZERO_ANY_INVARIANT", "ZERO_SUPPRESSIONS_INVARIANT"],
  ),
  mkVal("validator", ["ANTI_BOUNDARY_LEAK", "COGNITIVE_HARD_LOCK", "READ_ONLY_OBSERVER"]),
  mkVal("completeness-critic", ["ANTI_BOUNDARY_LEAK", "COGNITIVE_HARD_LOCK"]),
  mk(
    "planner",
    2,
    "deliberate",
    "x",
    ["bun harness.ts plan:*", "bun harness.ts msg:*"],
    ["edit_file", "write_to_file", "task:claim"],
    [],
    ["MANDATORY_BRAINSTORM_BEFORE_COMPILE", "SUPERVISOR_ZERO_CODE_EDITS"],
  ),
  mkVal("plan-validator", ["REJECT_SHALLOW_UMBRELLA_COMPRESSION", "ANTI_BOUNDARY_LEAK"]),
  mk(
    "publisher",
    3,
    "default",
    "wxl",
    PUB_CMDS,
    ["authority:decide", "mind:admit"],
    [],
    ["PUBLISHER_TRANSACTION_ISOLATION", "ZERO_SOURCE_EDITS", "ATOMIC_RELEASE_ONLY"],
  ),
  mk(
    "sub-implementer",
    3,
    "default",
    "wxl",
    ["bun harness.ts *", "bun test *"],
    ["authority:decide", "mind:admit"],
    [],
    ["LEAF_WORKER_CONFINEMENT"],
  ),
  mkVal("sub-validator", ["ANTI_BOUNDARY_LEAK", "COGNITIVE_HARD_LOCK"]),
  mkVal("sub-investigator", ["READ_ONLY_CONFINEMENT"], "cheap_bulk"),
  mk(
    "owner",
    "independent",
    "deliberate",
    "wxs",
    ["bun harness.ts *", "authority:decide", "agent:register", "doctor"],
    [],
    ["mind", "orchestrator", "coordinator"],
    ["GENESIS_AUTHORITY_CONFERRAL", "FAIL_CLOSED_RBAC"],
  ),
  mk(
    "independent-planner",
    "independent",
    "deliberate",
    "",
    ["msg:send", "msg:recv", "msg:poll"],
    ["edit_file", "write_to_file", "task:claim", "run_command"],
    [],
    ["COMPLETE_HARNESS_DECOUPLING", "PURE_ENGLISH_CONCEPTUAL_STANDARD"],
  ),
]);

export function getRoleCapabilities(role: string): RoleCapabilityEntry {
  const exact = CANONICAL_ROLE_CAPABILITIES[role];
  if (exact !== undefined) return exact;

  const profile = resolveRoleArchetype(role);
  const isVal =
    profile === "adversarial" ||
    role.startsWith("validator") ||
    role.includes("critic") ||
    role.includes("auditor");
  const isSup =
    profile === "deliberate" ||
    role.includes("coord") ||
    role.includes("orchestrat") ||
    role.includes("superv");
  const tier: RoleExecutionTier = role.includes("mind")
    ? 0
    : role.includes("orchestrat")
      ? 1
      : role.includes("coord") || role.includes("planner")
        ? 2
        : 3;

  return {
    role,
    tier,
    profile,
    canWriteCode: !isVal && !isSup,
    canExecuteCommands: !isVal,
    canSpawnSubagents: isSup || (!role.startsWith("sub-") && !isVal),
    canClaimLeases: !isVal && !isSup,
    allowedCommands: isVal ? [] : ["bun harness.ts *"],
    forbiddenCommands: isVal ? [...FORBIDDEN_VALIDATOR_COMMANDS] : [],
    allowedSpawns: [],
    invariants: isVal
      ? ["ANTI_BOUNDARY_LEAK", "COGNITIVE_HARD_LOCK"]
      : isSup
        ? ["SUPERVISOR_ZERO_CODE_EDITS"]
        : [],
  };
}

export function isCodeWritePermitted(role: string): boolean {
  return getRoleCapabilities(role).canWriteCode;
}

export function isSubagentSpawnPermitted(role: string, childRole?: string): boolean {
  const caps = getRoleCapabilities(role);
  if (!caps.canSpawnSubagents) return false;
  if (childRole !== undefined && caps.allowedSpawns.length > 0) {
    return caps.allowedSpawns.includes(childRole);
  }
  return true;
}

export function isCommandPermitted(role: string, command: string): boolean {
  const caps = getRoleCapabilities(role);
  if (caps.forbiddenCommands.includes(command)) return false;
  return caps.canExecuteCommands;
}

export function evaluateWatchdogRoleBoundary(
  role: string,
  action: RoleActionType,
  target?: string,
): { allowed: boolean; violation?: RoleBoundaryViolation } {
  const caps = getRoleCapabilities(role);
  let ruleId = "";
  let message = "";

  if (action === "code_write" && !caps.canWriteCode) {
    ruleId = "watchdog:role-boundary:zero-code-edits";
    message = `Role '${role}' is prohibited from direct code modifications.`;
  } else if (action === "subagent_spawn") {
    if (!caps.canSpawnSubagents) {
      ruleId = "watchdog:role-boundary:no-spawn-authority";
      message = `Role '${role}' (Tier ${caps.tier}) does not have subagent spawn authority.`;
    } else if (
      target !== undefined &&
      caps.allowedSpawns.length > 0 &&
      !caps.allowedSpawns.includes(target)
    ) {
      ruleId = "watchdog:role-boundary:unauthorized-child-spawn";
      message = `Role '${role}' is not permitted to spawn '${target}'. Allowed spawns: [${caps.allowedSpawns.join(", ")}].`;
    }
  } else if (action === "command_exec" && target !== undefined) {
    if (
      caps.forbiddenCommands.includes(target) ||
      (!caps.canExecuteCommands && FORBIDDEN_VALIDATOR_COMMANDS.has(target))
    ) {
      ruleId = "watchdog:role-boundary:forbidden-command";
      message = `Role '${role}' attempted to execute forbidden command '${target}'.`;
    }
  } else if (action === "lease_claim" && !caps.canClaimLeases) {
    ruleId = "watchdog:role-boundary:lease-prohibited";
    message = `Role '${role}' is prohibited from claiming task write leases.`;
  }

  if (ruleId !== "") {
    return { allowed: false, violation: { role, action, target, ruleId, message } };
  }
  return { allowed: true };
}
