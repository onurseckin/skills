import { HarnessError } from "../../core/errors/index.ts";
import { SUPERVISORY_ROLE_BOUNDARIES } from "./constants.ts";
import type {
  ActiveLeaseInfo,
  RoleBoundaryProfile,
  ScopeOverlapConflict,
  SupervisoryRole,
} from "./types.ts";

export function isSupervisoryRole(role: string): role is SupervisoryRole {
  const normalized = role.trim().toLowerCase();
  return normalized === "mind" || normalized === "orchestrator" || normalized === "coordinator";
}

export function normalizeSupervisoryRole(role: string): SupervisoryRole | null {
  const normalized = role.trim().toLowerCase();
  if (
    normalized === "mind" ||
    normalized === "tier-0" ||
    normalized === "tier 0" ||
    normalized === "human"
  ) {
    return "mind";
  }
  if (
    normalized === "orchestrator" ||
    normalized === "orch" ||
    normalized === "tier-1" ||
    normalized === "tier 1"
  ) {
    return "orchestrator";
  }
  if (
    normalized === "coordinator" ||
    normalized === "coord" ||
    normalized === "tier-2" ||
    normalized === "tier 2"
  ) {
    return "coordinator";
  }
  return null;
}

export function getRoleBoundaryProfile(role: SupervisoryRole | string): RoleBoundaryProfile {
  const normalized = normalizeSupervisoryRole(role);
  if (!normalized) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `role '${role}' is not a recognized supervisory role (expected mind, orchestrator, or coordinator)`,
    );
  }
  return SUPERVISORY_ROLE_BOUNDARIES[normalized];
}

export function getAllRoleBoundaryProfiles(): readonly RoleBoundaryProfile[] {
  return [
    SUPERVISORY_ROLE_BOUNDARIES.mind,
    SUPERVISORY_ROLE_BOUNDARIES.orchestrator,
    SUPERVISORY_ROLE_BOUNDARIES.coordinator,
  ];
}

export function parseNowMs(input?: string | number | Date | undefined): number {
  if (typeof input === "number") return input;
  if (input instanceof Date) return input.getTime();
  if (typeof input === "string") {
    const parsed = Date.parse(input);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

export function findOverlappingScopes(
  leases: readonly ActiveLeaseInfo[],
): readonly ScopeOverlapConflict[] {
  const conflicts: { taskA: string; taskB: string; overlappingFiles: string[] }[] = [];

  for (let i = 0; i < leases.length; i++) {
    for (let j = i + 1; j < leases.length; j++) {
      const leaseA = leases[i]!;
      const leaseB = leases[j]!;
      const scopeA = leaseA.writeScope ?? [];
      const scopeB = leaseB.writeScope ?? [];

      const overlaps = scopeA.filter((file) => scopeB.includes(file));
      if (overlaps.length > 0) {
        conflicts.push({
          taskA: leaseA.taskId,
          taskB: leaseB.taskId,
          overlappingFiles: overlaps,
        });
      }
    }
  }

  return conflicts;
}
