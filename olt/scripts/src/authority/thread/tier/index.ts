export type ExecutionTier = 0 | 1 | 2 | 3;

export interface TierSpawningValidationResult {
  readonly allowed: boolean;
  readonly parentTier: ExecutionTier;
  readonly childTier: ExecutionTier;
  readonly parentRole: string | null;
  readonly childRole: string | null;
  readonly reason: string | null;
}

export function parseTierValue(value: string | undefined): ExecutionTier | null {
  if (!value) return null;
  const normalized = value.trim();
  if (normalized === "0") return 0;
  if (normalized === "1") return 1;
  if (normalized === "2") return 2;
  if (normalized === "3") return 3;
  return null;
}

export function roleToTier(role: string): ExecutionTier {
  if (!role || typeof role !== "string") {
    return 3;
  }
  const normalized = role.toLowerCase().trim();
  if (
    normalized === "mind-auditor" ||
    normalized.startsWith("mind-auditor") ||
    normalized.startsWith("mind_auditor")
  ) {
    return 1;
  }
  if (normalized === "mind" || normalized.startsWith("mind-") || normalized.startsWith("mind_")) {
    return 0;
  }
  if (
    normalized === "orchestrator" ||
    normalized.startsWith("orchestrator-") ||
    normalized.startsWith("orchestrator_")
  ) {
    return 1;
  }
  if (
    normalized === "coordinator" ||
    normalized.startsWith("coordinator-") ||
    normalized.startsWith("coordinator_")
  ) {
    return 2;
  }
  return 3;
}

export function agentIdToTier(agentId: string): ExecutionTier | null {
  if (!agentId || typeof agentId !== "string") return null;
  const normalized = agentId
    .toLowerCase()
    .trim()
    .replace(/^(?:parent|agent)[-_]/i, "");
  if (normalized.startsWith("mind-auditor") || normalized.startsWith("mind_auditor")) return 1;
  if (normalized.startsWith("mind")) return 0;
  if (normalized.startsWith("orchestrator")) return 1;
  if (normalized.startsWith("coordinator")) return 2;
  if (
    normalized.startsWith("implementer") ||
    normalized.startsWith("validator") ||
    normalized.startsWith("completeness-critic") ||
    normalized.startsWith("planner") ||
    normalized.startsWith("plan-validator") ||
    normalized.startsWith("sub-implementer") ||
    normalized.startsWith("sub-validator") ||
    normalized.startsWith("sub-investigator") ||
    normalized.startsWith("validator-code-quality") ||
    normalized.startsWith("validator-ui-design") ||
    normalized.startsWith("validator-security") ||
    normalized.startsWith("validator-product") ||
    normalized.startsWith("validator-system-design") ||
    normalized.startsWith("ui-headless-validator") ||
    normalized.startsWith("ui-optical-validator")
  ) {
    return 3;
  }
  return null;
}

export function agentIdToRole(agentId: string): string | null {
  if (!agentId || typeof agentId !== "string") return null;
  const normalized = agentId
    .toLowerCase()
    .trim()
    .replace(/^(?:parent|agent)[-_]/i, "");
  if (normalized.startsWith("mind-auditor")) return "mind-auditor";
  if (normalized.startsWith("mind")) return "mind";
  if (normalized.startsWith("orchestrator")) return "orchestrator";
  if (normalized.startsWith("coordinator")) return "coordinator";
  if (normalized.startsWith("ui-headless-validator")) return "ui-headless-validator";
  if (normalized.startsWith("ui-optical-validator")) return "ui-optical-validator";
  if (normalized.startsWith("validator-code-quality")) return "validator-code-quality";
  if (normalized.startsWith("validator-ui-design")) return "validator-ui-design";
  if (normalized.startsWith("validator-security")) return "validator-security";
  if (normalized.startsWith("validator-product")) return "validator-product";
  if (normalized.startsWith("validator-system-design")) return "validator-system-design";
  if (normalized.startsWith("sub-implementer")) return "sub-implementer";
  if (normalized.startsWith("sub-validator")) return "sub-validator";
  if (normalized.startsWith("sub-investigator")) return "sub-investigator";
  if (normalized.startsWith("implementer")) return "implementer";
  if (normalized.startsWith("validator")) return "validator";
  if (normalized.startsWith("completeness-critic")) return "completeness-critic";
  if (normalized.startsWith("plan-validator")) return "plan-validator";
  if (normalized.startsWith("planner")) return "planner";
  return null;
}

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
      reason: `Tier 2 Coordinator Lead cannot deploy Tier ${childTier} (${cRole}). Coordinators deploy Tier 3 Implementers, Validators, and Critics.`,
    };
  }

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
