import type { AgentRole } from "../core/contracts/index.ts";
import { HarnessError } from "../core/errors/index.ts";
import { loadRoleContract, resolveRoleContractPath, type RoleContract } from "./role-contract.ts";
import {
  formatHierarchicalRemediation,
  formatDeclaredSpawnRemediation,
  resolveCurrentHost,
  type DetectedHost,
} from "./command-authority-remediation.ts";

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
  readonly remediation?: string;
}

export function validateHierarchicalSpawning(
  parentRole: string,
  childRole: string,
  host?: DetectedHost,
): HierarchicalSpawningCheck {
  const pTier = roleToTier(parentRole);
  const cTier = roleToTier(childRole);
  const activeHost = host !== undefined ? host : resolveCurrentHost();
  const remediation = formatHierarchicalRemediation(pTier, cTier, activeHost);

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
      remediation,
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
      remediation,
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
      remediation,
    };
  }

  return {
    valid: false,
    parentRole,
    childRole,
    parentTier: pTier,
    childTier: cTier,
    reason: `Tier 3 worker (${parentRole}) is a leaf execution worker and cannot spawn child subagents ('${childRole}').`,
    remediation,
  };
}

export function assertHierarchicalSpawning(
  parentRole: string,
  childRole: string,
  parentAgentId?: string,
  childAgentId?: string,
  host?: DetectedHost,
): void {
  const result = validateHierarchicalSpawning(parentRole, childRole, host);
  if (!result.valid) {
    const parentDisplay = parentAgentId ? `'${parentAgentId}' (${parentRole})` : `'${parentRole}'`;
    const childDisplay = childAgentId ? `'${childAgentId}' (${childRole})` : `'${childRole}'`;
    const remediationSuffix = result.remediation ? ` ${result.remediation}` : "";
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `Hierarchical Parent-Child Boundary Violation: Supervisor ${parentDisplay} cannot dispatch subagent ${childDisplay}. ${result.reason}${remediationSuffix}`,
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
  host?: DetectedHost,
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
  const activeHost = host !== undefined ? host : resolveCurrentHost();
  const remediation = formatDeclaredSpawnRemediation(parentRole, childRole, activeHost);
  throw new HarnessError(
    "ROLE_CONFINEMENT_VIOLATION",
    `Declared spawn allowlist violation: supervisor ${parentDisplay} may not dispatch subagent ${childDisplay}; the role contract at ${resolveRoleContractPath(parentRole)} restricts spawns to [${contract.spawns.join(", ")}], and '${childRole}' is not declared among them. ${remediation}`,
  );
}

export function assertSpawnAuthorized(
  parentRole: AgentRole,
  childRole: string,
  parentAgentId?: string,
  childAgentId?: string,
  host?: DetectedHost,
): void {
  if (isBranchWorkerSpawn(parentRole, childRole)) return;
  assertHierarchicalSpawning(parentRole, childRole, parentAgentId, childAgentId, host);
  assertDeclaredSpawnAllowed(parentRole, childRole, parentAgentId, childAgentId, host);
}
