import { CODE_EDIT_TOOLS, VALIDATION_COMMANDS } from "./hierarchy.ts";
import {
  isValidatorRole,
  isImplementerRole,
  isCognitiveValidatorRole,
  isMindRole,
  isOrchestratorRole,
  isCoordinatorRole,
  PROHIBITED_COGNITIVE_TOOLS,
  PROHIBITED_COGNITIVE_TOOL_CATEGORIES,
  type RoleBoundaryAction,
  type RoleBoundaryViolation,
} from "./matrix.ts";

export function checkAntiBoundaryLeak(
  action: RoleBoundaryAction,
  tier: number,
  timestamp: string,
): RoleBoundaryViolation | null {
  const argv = action.argv ?? [];
  if (
    isValidatorRole(action.role) &&
    (action.actionType === "file_write" ||
      action.actionType === "code_write" ||
      CODE_EDIT_TOOLS.has((action.toolName ?? "").toLowerCase()))
  ) {
    return {
      id: `VIOL-LEAK-VAL-${action.agentId}-${Date.now()}`,
      invariant: "anti_boundary_leak",
      violationType: "validator_code_writing",
      severity: "CRITICAL",
      agentId: action.agentId,
      role: action.role,
      tier: 3,
      title: "Validator Anti-Boundary Leak Violation",
      observation: `Validator '${action.agentId}' attempted code write '${action.targetFile ?? action.toolName}'.`,
      remediation: "Validators must remain read-only verification agents.",
      action,
      timestamp,
    };
  }
  if (
    isImplementerRole(action.role) &&
    (argv.some((a) => VALIDATION_COMMANDS.has(a)) || argv.includes("task:review"))
  ) {
    return {
      id: `VIOL-LEAK-IMPL-${action.agentId}-${Date.now()}`,
      invariant: "anti_boundary_leak",
      violationType: "implementer_self_grading",
      severity: "CRITICAL",
      agentId: action.agentId,
      role: action.role,
      tier: 3,
      title: "Implementer Self-Grading Violation",
      observation: `Implementer '${action.agentId}' attempted self-validation '${argv.join(" ")}'.`,
      remediation: "Validation commands belong exclusively to independent Validators.",
      action,
      timestamp,
    };
  }
  return null;
}

export function checkValidatorHardLock(
  action: RoleBoundaryAction,
  tier: number,
  timestamp: string,
): RoleBoundaryViolation | null {
  if (!isCognitiveValidatorRole(action.role)) return null;
  const argv = action.argv ?? [];
  const tool = (action.toolName ?? "").toLowerCase();
  const isProhibitedTool = PROHIBITED_COGNITIVE_TOOLS.has(tool);
  const isProhibitedCat = action.toolCategory
    ? PROHIBITED_COGNITIVE_TOOL_CATEGORIES.has(action.toolCategory)
    : false;
  const isExecAction =
    action.actionType === "command_exec" ||
    action.actionType === "test_run" ||
    action.actionType === "test_execution";

  if (isProhibitedTool || isProhibitedCat || isExecAction) {
    return {
      id: `VIOL-HARDLOCK-VAL-${action.agentId}-${Date.now()}`,
      invariant: "validator_hardlock",
      violationType: "validator_hardlock_violation",
      severity: "CRITICAL",
      agentId: action.agentId,
      role: action.role,
      tier: 3,
      title: "Cognitive Validator Hard-Lock Interlock Violation",
      observation: `Cognitive Validator Hard-Lock Violation: Cognitive Validator '${action.agentId}' attempted execution action '${tool || argv.join(" ")}'.`,
      remediation:
        "Cognitive Validators must evaluate deliverables strictly via read-only inspection.",
      action,
      timestamp,
    };
  }
  return null;
}

export function checkSpawning(
  action: RoleBoundaryAction,
  tier: number,
  timestamp: string,
): RoleBoundaryViolation | null {
  if (action.actionType !== "spawning") return null;
  if (tier === 3 || isImplementerRole(action.role) || isValidatorRole(action.role)) {
    return {
      id: `VIOL-SPAWN-LEAF-${action.agentId}-${Date.now()}`,
      invariant: "spawning_hierarchy",
      violationType: "leaf_spawning",
      severity: "CRITICAL",
      agentId: action.agentId,
      role: action.role,
      tier: 3,
      title: "Hierarchy Violation: Tier 3 Leaf Spawning Subagent",
      observation: `Tier 3 Leaf agent '${action.agentId}' attempted to spawn subagent.`,
      remediation: "Clear spawns for Tier 3 workers.",
      action,
      timestamp,
    };
  }
  if (tier === 0 && action.targetRole && !isOrchestratorRole(action.targetRole)) {
    return {
      id: `VIOL-SPAWN-TIER0-${action.agentId}-${Date.now()}`,
      invariant: "spawning_hierarchy",
      violationType: "cross_tier_spawning",
      severity: "CRITICAL",
      agentId: action.agentId,
      role: action.role,
      tier: 0,
      title: "Hierarchy Violation: Tier 0 Cross-Tier Spawning",
      observation: `Tier 0 Mind dispatched non-orchestrator '${action.targetRole}'. Mind may only dispatch Tier 1 Orchestrators.`,
      remediation: "Mind may only spawn Tier 1 Orchestrator.",
      action,
      timestamp,
    };
  }
  if (tier === 1 && action.targetRole && !isCoordinatorRole(action.targetRole)) {
    return {
      id: `VIOL-SPAWN-TIER1-${action.agentId}-${Date.now()}`,
      invariant: "spawning_hierarchy",
      violationType: "cross_tier_spawning",
      severity: "CRITICAL",
      agentId: action.agentId,
      role: action.role,
      tier: 1,
      title: "Hierarchy Violation: Tier 1 Cross-Tier Spawning",
      observation: `Tier 1 Orchestrator dispatched non-coordinator '${action.targetRole}'. Orchestrators may only dispatch Tier 2 Coordinators.`,
      remediation: "Orchestrator may only spawn Tier 2 Coordinator.",
      action,
      timestamp,
    };
  }
  if (
    tier === 2 &&
    action.targetRole &&
    (isMindRole(action.targetRole) ||
      isOrchestratorRole(action.targetRole) ||
      isCoordinatorRole(action.targetRole))
  ) {
    return {
      id: `VIOL-SPAWN-TIER2-${action.agentId}-${Date.now()}`,
      invariant: "spawning_hierarchy",
      violationType: "cross_tier_spawning",
      severity: "CRITICAL",
      agentId: action.agentId,
      role: action.role,
      tier: 2,
      title: "Hierarchy Violation: Tier 2 Cross-Tier Spawning",
      observation: `Tier 2 Coordinator dispatched non-Tier-3 '${action.targetRole}'.`,
      remediation: "Coordinators may only spawn Tier 3 workers.",
      action,
      timestamp,
    };
  }
  return null;
}

export function checkForbidden(
  action: RoleBoundaryAction,
  tier: number,
  timestamp: string,
): RoleBoundaryViolation | null {
  const argv = action.argv ?? [];
  if (argv.includes("orchestrator:run")) {
    return {
      id: `VIOL-CMD-ORCHRUN-${action.agentId}-${Date.now()}`,
      invariant: "command_authorization",
      violationType: "forbidden_command_execution",
      severity: "CRITICAL",
      agentId: action.agentId,
      role: action.role,
      tier,
      title: "Forbidden Command Execution Attempt",
      observation: `Agent '${action.agentId}' executed forbidden 'orchestrator:run'.`,
      remediation: "Remove all invocations of 'orchestrator:run'.",
      action,
      timestamp,
    };
  }
  if (tier < 3 && argv.includes("task:claim")) {
    return {
      id: `VIOL-CMD-SUPERCLAIM-${action.agentId}-${Date.now()}`,
      invariant: "command_authorization",
      violationType: "supervisory_task_claim",
      severity: "HIGH",
      agentId: action.agentId,
      role: action.role,
      tier,
      title: "Supervisory Task Claim Execution Attempt",
      observation: `Supervisory agent '${action.agentId}' attempted 'task:claim'.`,
      remediation: "Task claim is reserved for Tier 3 Implementers.",
      action,
      timestamp,
    };
  }
  return null;
}
