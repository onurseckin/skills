import { roleToTier } from "../../../packets/command-authority.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import { RoleBoundaryWatchdog } from "./reporter.ts";
import {
  isCoordinatorRole,
  isMindRole,
  isOrchestratorRole,
  type RoleBoundaryAction,
  type RoleBoundaryAuditResult,
  type RoleBoundaryViolation,
  type RoleBoundaryWatchdogOptions,
} from "./rules/index.ts";

export function createRoleBoundaryWatchdog(
  options: RoleBoundaryWatchdogOptions = {},
): RoleBoundaryWatchdog {
  return new RoleBoundaryWatchdog(options);
}

export function verifyRoleBoundaryAction(
  action: RoleBoundaryAction,
  options: RoleBoundaryWatchdogOptions = {},
): RoleBoundaryViolation | null {
  const watchdog = new RoleBoundaryWatchdog(options);
  return watchdog.auditAction(action);
}

export function auditRoleBoundaryActions(
  actions: readonly RoleBoundaryAction[],
  options: RoleBoundaryWatchdogOptions = {},
): RoleBoundaryAuditResult {
  const watchdog = new RoleBoundaryWatchdog(options);
  return watchdog.auditActions(actions);
}

export interface ParentChildSupervisionResult {
  readonly valid: boolean;
  readonly parentRole: string;
  readonly childRole: string;
  readonly parentTier: number;
  readonly childTier: number;
  readonly reason?: string;
}

export function validateParentChildSupervision(
  parentRole: string,
  childRole: string,
): ParentChildSupervisionResult {
  const pTier = roleToTier(parentRole);
  const cTier = roleToTier(childRole);

  // Tier 0 Mind -> Tier 1 Orchestrator only
  if (pTier === 0) {
    if (cTier === 1 && isOrchestratorRole(childRole)) {
      return { valid: true, parentRole, childRole, parentTier: pTier, childTier: cTier };
    }
    return {
      valid: false,
      parentRole,
      childRole,
      parentTier: pTier,
      childTier: cTier,
      reason: `Tier 0 Mind (${parentRole}) may only dispatch Tier 1 Orchestrators. Disagreeing child role '${childRole}' (Tier ${cTier}) violates hierarchical parent-child boundary.`,
    };
  }

  // Tier 1 Orchestrator -> Tier 2 Coordinator only
  if (pTier === 1) {
    if (cTier === 2 && isCoordinatorRole(childRole)) {
      return { valid: true, parentRole, childRole, parentTier: pTier, childTier: cTier };
    }
    return {
      valid: false,
      parentRole,
      childRole,
      parentTier: pTier,
      childTier: cTier,
      reason: `Tier 1 Orchestrator (${parentRole}) may only dispatch Tier 2 Coordinators. Disagreeing child role '${childRole}' (Tier ${cTier}) violates hierarchical parent-child boundary.`,
    };
  }

  // Tier 2 Coordinator -> Tier 3 workers only
  if (pTier === 2) {
    if (
      cTier === 3 &&
      !isMindRole(childRole) &&
      !isOrchestratorRole(childRole) &&
      !isCoordinatorRole(childRole)
    ) {
      return { valid: true, parentRole, childRole, parentTier: pTier, childTier: cTier };
    }
    return {
      valid: false,
      parentRole,
      childRole,
      parentTier: pTier,
      childTier: cTier,
      reason: `Tier 2 Coordinator (${parentRole}) may only dispatch Tier 3 workers (Implementers, Validators, Critics, Repairers). Disagreeing child role '${childRole}' (Tier ${cTier}) violates hierarchical parent-child boundary.`,
    };
  }

  // Tier 3 Leaf workers -> cannot spawn children
  return {
    valid: false,
    parentRole,
    childRole,
    parentTier: pTier,
    childTier: cTier,
    reason: `Tier 3 worker (${parentRole}) is a leaf execution agent and cannot dispatch child agents ('${childRole}').`,
  };
}

export function assertParentChildBoundary(
  parentRole: string,
  childRole: string,
  parentAgentId?: string,
  childAgentId?: string,
): void {
  const result = validateParentChildSupervision(parentRole, childRole);
  if (!result.valid) {
    const parentDisplay = parentAgentId ? `'${parentAgentId}' (${parentRole})` : `'${parentRole}'`;
    const childDisplay = childAgentId ? `'${childAgentId}' (${childRole})` : `'${childRole}'`;
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `Active Hierarchical Parent-Child Boundary Violation: Supervisor ${parentDisplay} cannot dispatch subagent ${childDisplay}. ${result.reason}`,
    );
  }
}
