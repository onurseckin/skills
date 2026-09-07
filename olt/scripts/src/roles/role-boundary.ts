import { FORBIDDEN_VALIDATOR_COMMANDS } from "./authority.ts";
import { CANONICAL_ROLE_CAPABILITIES } from "./capability-matrix.ts";
import { resolveRoleArchetype } from "./profiles.ts";
import type {
  RoleActionType,
  RoleBoundaryViolation,
  RoleCapabilityEntry,
  RoleExecutionTier,
} from "./types.ts";

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
