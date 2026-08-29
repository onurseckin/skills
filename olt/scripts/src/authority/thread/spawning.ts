import type { ExecutionTier, TierSpawningValidationResult } from "./types.ts";

export function validateTierSpawning(
  parentTier: ExecutionTier,
  childTier: ExecutionTier,
  parentRole?: string | null,
  childRole?: string | null,
): TierSpawningValidationResult {
  const pRole =
    parentRole ??
    (parentTier === 0
      ? "mind"
      : parentTier === 1
        ? "orchestrator"
        : parentTier === 2
          ? "coordinator"
          : "implementer");
  const cRole =
    childRole ??
    (childTier === 1 ? "orchestrator" : childTier === 2 ? "coordinator" : "implementer");

  // Tier 0 (Mind) can deploy Tier 1 (Orchestrator, Mind Auditor)
  if (parentTier === 0) {
    if (childTier === 1) {
      return {
        allowed: true,
        parentTier,
        childTier,
        parentRole: pRole,
        childRole: cRole,
        reason: null,
      };
    }
    return {
      allowed: false,
      parentTier,
      childTier,
      parentRole: pRole,
      childRole: cRole,
      reason: `Tier 0 Mind Lead cannot directly spawn Tier ${childTier} (${cRole}). Mind may only deploy Tier 1 Orchestrators.`,
    };
  }

  // Tier 1 (Orchestrator) can deploy Tier 2 (Coordinator)
  if (parentTier === 1) {
    if (childTier === 2) {
      return {
        allowed: true,
        parentTier,
        childTier,
        parentRole: pRole,
        childRole: cRole,
        reason: null,
      };
    }
    return {
      allowed: false,
      parentTier,
      childTier,
      parentRole: pRole,
      childRole: cRole,
      reason: `Tier 1 Orchestrator Lead cannot directly spawn Tier ${childTier} (${cRole}). Orchestrators must deploy Tier 2 Coordinators to manage wave execution.`,
    };
  }

  // Tier 2 (Coordinator) can deploy Tier 3 (Implementers, Validators, Critics, Repairers, Planners)
  if (parentTier === 2) {
    if (childTier === 3) {
      return {
        allowed: true,
        parentTier,
        childTier,
        parentRole: pRole,
        childRole: cRole,
        reason: null,
      };
    }
    return {
      allowed: false,
      parentTier,
      childTier,
      parentRole: pRole,
      childRole: cRole,
      reason: `Tier 2 Coordinator Lead cannot deploy Tier ${childTier} (${cRole}). Coordinators deploy Tier 3 Implementers, Validators, Repairers, and Critics.`,
    };
  }

  // Tier 3 (Implementers/Validators) can only spawn Tier 3 sub-agents (sub-implementer, sub-validator, sub-investigator)
  if (parentTier === 3) {
    if (childTier === 3) {
      return {
        allowed: true,
        parentTier,
        childTier,
        parentRole: pRole,
        childRole: cRole,
        reason: null,
      };
    }
    return {
      allowed: false,
      parentTier,
      childTier,
      parentRole: pRole,
      childRole: cRole,
      reason: `Tier 3 worker cannot spawn Tier ${childTier} (${cRole}) (role escalation violation).`,
    };
  }

  return {
    allowed: false,
    parentTier,
    childTier,
    parentRole: pRole,
    childRole: cRole,
    reason: `Invalid tier hierarchy transition from Tier ${parentTier} to Tier ${childTier}.`,
  };
}
