import { HarnessError } from "../../core/errors/index.ts";
import {
  isSupervisoryTierRole,
  isTier0Auditor,
  isTier0AuditorAgentId,
  isTier0AuditorRole,
  verifySupervisoryRoleBoundary,
} from "./role-boundary-verifier.ts";
import type {
  AdoptionConfinementParams,
  ConfinementValidationResult,
  RegistrationConfinementParams,
} from "./types.ts";

export function safeFormatValue(val: unknown): string {
  if (val === null) return "null";
  if (val === undefined) return "undefined";
  if (typeof val === "symbol") return val.toString();
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean" || typeof val === "bigint") {
    return String(val);
  }
  try {
    return JSON.stringify(val);
  } catch {
    return "[Unstringifiable Object]";
  }
}

export function isSubordinateRole(role: string): boolean {
  if (typeof role !== "string") return true;
  const normalized = role.trim().toLowerCase().replace(/_/g, "-");
  if (isTier0AuditorRole(normalized)) return false;
  if (
    normalized === "mind" ||
    normalized.startsWith("mind-") ||
    normalized === "optimizer-orchestrator" ||
    normalized === "orchestrator" ||
    normalized.startsWith("orchestrator-") ||
    normalized === "domain-orchestrator"
  ) {
    return false;
  }
  return true;
}

export function assertStrictNullParent(
  agentId: string,
  role: string,
  parentAgentId: unknown,
): void {
  if (parentAgentId === null) {
    return;
  }

  if (parentAgentId === undefined) {
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `Tier 0 auditor '${agentId}' (role: ${role}) cannot have an undefined parent_agent_id; ` +
        `Tier 0 auditors must explicitly declare 'parent_agent_id: null' to verify out-of-band companion confinement.`,
    );
  }

  if (typeof parentAgentId === "string") {
    if (parentAgentId === "" || parentAgentId.trim() === "") {
      throw new HarnessError(
        "ROLE_CONFINEMENT_VIOLATION",
        `Tier 0 auditor '${agentId}' (role: ${role}) received empty string parent_agent_id; ` +
          `must explicitly be strict null, not an empty string representation.`,
      );
    }
    if (parentAgentId.trim().toLowerCase() === "null") {
      throw new HarnessError(
        "ROLE_CONFINEMENT_VIOLATION",
        `Tier 0 auditor '${agentId}' (role: ${role}) received string literal "null" as parent_agent_id; ` +
          `must explicitly be strict null literal, not string type coercion.`,
      );
    }
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `Tier 0 auditor '${agentId}' (role: ${role}) cannot be subordinated under parent '${parentAgentId}'. ` +
        `Tier 0 auditors are strictly unparented companion monitors ('parent_agent_id: null').`,
    );
  }

  const formatted = safeFormatValue(parentAgentId);
  throw new HarnessError(
    "ROLE_CONFINEMENT_VIOLATION",
    `Tier 0 auditor '${agentId}' (role: ${role}) received non-null parent_agent_id value ` +
      `'${formatted}' of type '${typeof parentAgentId}'. Tier 0 auditors require strict 'parent_agent_id: null'.`,
  );
}

export function assertTier0CannotParentSubordinates(agentId: string, parentAgentId: unknown): void {
  if (typeof parentAgentId === "string" && isTier0Auditor(parentAgentId)) {
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `Tier 0 auditor '${parentAgentId}' cannot serve as parent for agent '${agentId}'. ` +
        `Tier 0 companion auditors have no subordinate hierarchy and cannot parent execution agents.`,
    );
  }
}

export function assertSubordinateMustBeParented(
  agentId: string,
  role: string,
  parentAgentId: unknown,
  isRootGenesis?: boolean,
): void {
  if (isRootGenesis === true) return;
  if (!isSubordinateRole(role)) return;

  if (parentAgentId === null || parentAgentId === undefined) {
    const formatted = safeFormatValue(parentAgentId);
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `Subordinate agent '${agentId}' with role '${role}' cannot be unparented ` +
        `('parent_agent_id' cannot be ${formatted}). Non-Tier 0 execution agents require a valid supervisor.`,
    );
  }

  if (typeof parentAgentId !== "string" || parentAgentId.trim() === "") {
    const formatted = safeFormatValue(parentAgentId);
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `Subordinate agent '${agentId}' with role '${role}' must specify a valid non-empty string ` +
        `parent_agent_id (received '${formatted}').`,
    );
  }
}

export function validateRegistrationConfinement(
  params: RegistrationConfinementParams,
): ConfinementValidationResult {
  const { agentId, role, parentAgentId, callerAgentId, callerRole, isRootGenesis } = params;

  if (callerAgentId !== undefined && callerAgentId !== null) {
    const effCallerRole = callerRole ?? callerAgentId;
    if (isSupervisoryTierRole(effCallerRole)) {
      try {
        verifySupervisoryRoleBoundary({
          supervisorId: callerAgentId,
          supervisorRole: effCallerRole,
          targetId: agentId,
          targetRole: role,
          action: "register",
        });
      } catch (err) {
        if (err instanceof HarnessError && err.code === "ROLE_CONFINEMENT_VIOLATION") {
          return {
            valid: false,
            code: "ROLE_CONFINEMENT_VIOLATION",
            reason: err.message,
            agentId,
            role,
            attemptedParentAgentId: parentAgentId,
          };
        }
        throw err;
      }
    }
  }

  if (isTier0AuditorRole(role) || isTier0AuditorAgentId(agentId)) {
    try {
      assertStrictNullParent(agentId, role, parentAgentId);
    } catch (err) {
      if (err instanceof HarnessError && err.code === "ROLE_CONFINEMENT_VIOLATION") {
        return {
          valid: false,
          code: "ROLE_CONFINEMENT_VIOLATION",
          reason: err.message,
          agentId,
          role,
          attemptedParentAgentId: parentAgentId,
        };
      }
      throw err;
    }

    return {
      valid: true,
      agentId,
      role,
      parentAgentId: null,
    };
  }

  try {
    assertTier0CannotParentSubordinates(agentId, parentAgentId);
    assertSubordinateMustBeParented(agentId, role, parentAgentId, isRootGenesis);

    if (typeof parentAgentId === "string" && isSupervisoryTierRole(parentAgentId)) {
      verifySupervisoryRoleBoundary({
        supervisorId: parentAgentId,
        supervisorRole: parentAgentId,
        targetId: agentId,
        targetRole: role,
        action: "subordinate",
      });
    }
  } catch (err) {
    if (err instanceof HarnessError && err.code === "ROLE_CONFINEMENT_VIOLATION") {
      return {
        valid: false,
        code: "ROLE_CONFINEMENT_VIOLATION",
        reason: err.message,
        agentId,
        role,
        attemptedParentAgentId: parentAgentId,
      };
    }
    throw err;
  }

  return {
    valid: true,
    agentId,
    role,
    parentAgentId: typeof parentAgentId === "string" ? parentAgentId : null,
  };
}

export function assertRegistrationConfinement(params: RegistrationConfinementParams): void {
  const result = validateRegistrationConfinement(params);
  if (!result.valid) {
    throw new HarnessError(result.code, result.reason);
  }
}

export function validateAdoptionConfinement(
  params: AdoptionConfinementParams,
): ConfinementValidationResult {
  const { targetAgentId, targetRole, newParentAgentId, callerAgentId, callerRole } = params;

  if (callerAgentId !== undefined && callerAgentId !== null) {
    const effCallerRole = callerRole ?? callerAgentId;
    if (isSupervisoryTierRole(effCallerRole)) {
      try {
        verifySupervisoryRoleBoundary({
          supervisorId: callerAgentId,
          supervisorRole: effCallerRole,
          targetId: targetAgentId,
          targetRole: targetRole,
          action: "adopt",
        });
      } catch (err) {
        if (err instanceof HarnessError && err.code === "ROLE_CONFINEMENT_VIOLATION") {
          return {
            valid: false,
            code: "ROLE_CONFINEMENT_VIOLATION",
            reason: err.message,
            agentId: targetAgentId,
            role: targetRole,
            attemptedParentAgentId: newParentAgentId,
          };
        }
        throw err;
      }
    }
  }

  if (isTier0AuditorRole(targetRole) || isTier0AuditorAgentId(targetAgentId)) {
    return {
      valid: false,
      code: "ROLE_CONFINEMENT_VIOLATION",
      reason:
        `Tier 0 auditor '${targetAgentId}' (role: ${targetRole}) cannot be adopted or reparented. ` +
        `Tier 0 companion auditors must remain unconditionally unparented ('parent_agent_id: null').`,
      agentId: targetAgentId,
      role: targetRole,
      attemptedParentAgentId: newParentAgentId,
    };
  }

  if (typeof newParentAgentId === "string" && isTier0Auditor(newParentAgentId)) {
    return {
      valid: false,
      code: "ROLE_CONFINEMENT_VIOLATION",
      reason:
        `Cannot set Tier 0 auditor '${newParentAgentId}' as new parent for '${targetAgentId}' (role: ${targetRole}). ` +
        `Tier 0 auditors cannot adopt or parent subordinate agents.`,
      agentId: targetAgentId,
      role: targetRole,
      attemptedParentAgentId: newParentAgentId,
    };
  }

  if (
    isSubordinateRole(targetRole) &&
    (newParentAgentId === null ||
      newParentAgentId === undefined ||
      typeof newParentAgentId !== "string" ||
      newParentAgentId.trim() === "")
  ) {
    const formatted = safeFormatValue(newParentAgentId);
    return {
      valid: false,
      code: "ROLE_CONFINEMENT_VIOLATION",
      reason:
        `Subordinate agent '${targetAgentId}' (role: ${targetRole}) cannot be adopted with invalid parent ` +
        `'${formatted}'. Subordinates cannot become unparented orphans via adoption.`,
      agentId: targetAgentId,
      role: targetRole,
      attemptedParentAgentId: newParentAgentId,
    };
  }

  if (typeof newParentAgentId === "string" && isSupervisoryTierRole(newParentAgentId)) {
    try {
      verifySupervisoryRoleBoundary({
        supervisorId: newParentAgentId,
        supervisorRole: newParentAgentId,
        targetId: targetAgentId,
        targetRole: targetRole,
        action: "adopt",
      });
    } catch (err) {
      if (err instanceof HarnessError && err.code === "ROLE_CONFINEMENT_VIOLATION") {
        return {
          valid: false,
          code: "ROLE_CONFINEMENT_VIOLATION",
          reason: err.message,
          agentId: targetAgentId,
          role: targetRole,
          attemptedParentAgentId: newParentAgentId,
        };
      }
      throw err;
    }
  }

  return {
    valid: true,
    agentId: targetAgentId,
    role: targetRole,
    parentAgentId: typeof newParentAgentId === "string" ? newParentAgentId : null,
  };
}

export function assertAdoptionConfinement(params: AdoptionConfinementParams): void {
  const result = validateAdoptionConfinement(params);
  if (!result.valid) {
    throw new HarnessError(result.code, result.reason);
  }
}
