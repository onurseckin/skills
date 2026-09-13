import { HarnessError } from "../../core/errors/index.ts";
import { isTier0Auditor } from "./tier0-confinement.ts";
import type { AgentSupervisionTier, SupervisoryBoundaryCheckParams } from "./types.ts";

export function resolveAgentTier(roleOrId: string): AgentSupervisionTier {
  if (typeof roleOrId !== "string") return 3;
  const normalized = roleOrId.trim().toLowerCase().replace(/_/g, "-");

  if (
    normalized === "skill-auditor" ||
    normalized.startsWith("skill-auditor-") ||
    normalized.includes("-skill-auditor") ||
    normalized === "mind-auditor" ||
    normalized.startsWith("mind-auditor-") ||
    normalized.includes("-mind-auditor") ||
    normalized === "mind" ||
    normalized.startsWith("mind-")
  ) {
    return 0;
  }

  if (
    normalized === "orchestrator" ||
    normalized.startsWith("orchestrator-") ||
    normalized.includes("-orchestrator") ||
    normalized === "domain-orchestrator" ||
    normalized === "optimizer-orchestrator"
  ) {
    return 1;
  }

  if (
    normalized === "coordinator" ||
    normalized.startsWith("coordinator-") ||
    normalized.includes("-coordinator")
  ) {
    return 2;
  }

  return 3;
}

export function isSupervisoryTierRole(role: string): boolean {
  const tier = resolveAgentTier(role);
  return tier === 1 || tier === 2;
}

export function verifySupervisoryRoleBoundary(params: SupervisoryBoundaryCheckParams): void {
  const { supervisorId, supervisorRole, targetId, targetRole, action } = params;

  if (isTier0Auditor(targetRole) || isTier0Auditor(targetId)) {
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `Supervisory agent '${supervisorId}' (role: ${supervisorRole}) is prohibited from performing ` +
        `'${action}' on Tier 0 auditor '${targetId}' (role: ${targetRole}). Tier 0 auditors are strictly ` +
        `out-of-band companions and cannot be subordinated under any supervisory tier.`,
    );
  }

  const supervisorTier = resolveAgentTier(supervisorRole || supervisorId);
  const targetTier = resolveAgentTier(targetRole || targetId);

  if (targetTier === 0) {
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `Hierarchy inversion breach: Supervisory agent '${supervisorId}' (Tier ${supervisorTier}) ` +
        `cannot perform '${action}' on Tier 0 governance entity '${targetId}'.`,
    );
  }

  if (supervisorTier === 1 && targetTier === 3) {
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `Direct-supervision shortcut breach (SKILL.md §37): Tier 1 Orchestrator '${supervisorId}' ` +
        `cannot directly ${action} Tier 3 specialist '${targetId}'. Tier 1 must dispatch strictly through ` +
        `a Tier 2 Coordinator. Direct Tier 1 -> Tier 3 shortcuts are forbidden.`,
    );
  }

  if (supervisorTier === 2 && targetTier === 1) {
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `Hierarchy inversion breach: Tier 2 Coordinator '${supervisorId}' cannot ${action} ` +
        `Tier 1 Orchestrator '${targetId}'. Coordinators cannot supervise or adopt orchestrators.`,
    );
  }

  if (supervisorTier === 2 && targetTier === 2 && supervisorId !== targetId) {
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `Horizontal cross-lane breach: Tier 2 Coordinator '${supervisorId}' cannot ${action} ` +
        `peer Tier 2 Coordinator '${targetId}'. Cross-lane coordinator subordination is prohibited.`,
    );
  }
}

export function assertNoSupervisoryAdoptionOfTier0(
  supervisorId: string,
  supervisorRole: string,
  targetAuditorId: string,
  targetAuditorRole: string,
): void {
  verifySupervisoryRoleBoundary({
    supervisorId,
    supervisorRole,
    targetId: targetAuditorId,
    targetRole: targetAuditorRole,
    action: "adopt",
  });
}

export function assertNoSupervisoryRegistrationOfTier0(
  supervisorId: string,
  supervisorRole: string,
  targetAuditorId: string,
  targetAuditorRole: string,
): void {
  verifySupervisoryRoleBoundary({
    supervisorId,
    supervisorRole,
    targetId: targetAuditorId,
    targetRole: targetAuditorRole,
    action: "register",
  });
}
