import type { AgentGrantRecord } from "../../../core/contracts/index.ts";
import { isJsonObject } from "../../../core/contracts/index.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import { SkillAuditorPolicy } from "../../../engine/scheduler/index.ts";
import { readAgentLedger } from "../../../workflow/agents/index.ts";
import type { DoctorCheckEngineResult, DoctorDiagnosticFinding } from "../index.ts";

export interface CompanionAuditorDoctorOptions {
  readonly repoRoot?: string | undefined;
  readonly state?: Readonly<Record<string, unknown>> | null | undefined;
  readonly grants?: readonly unknown[] | null | undefined;
  readonly events?: readonly unknown[] | null | undefined;
  readonly strict?: boolean | undefined;
}

function isMindRole(roleVal: unknown, id: string): boolean {
  if (roleVal === "mind") return true;
  if (roleVal === "mind-auditor") return true;
  if (id.includes("mind")) return true;
  return false;
}

function isMindAuditorRole(roleVal: unknown, id: string): boolean {
  if (roleVal === "mind-auditor") return true;
  if (roleVal === "meta-auditor") return true;
  if (id.includes("mind-auditor")) return true;
  return false;
}

function isSkillAuditorRole(roleVal: unknown, id: string): boolean {
  if (roleVal === "skill-auditor") return true;
  if (roleVal === "meta-auditor") return true;
  if (id.includes("skill-auditor")) return true;
  return false;
}

function checkExplicitMind(state: Readonly<Record<string, unknown>>): boolean {
  if (state.mind !== undefined && state.mind !== null && state.mind !== false) return true;
  if (state.pulse !== undefined && state.pulse !== null && state.pulse !== false) return true;
  if (typeof state.run_id === "string") {
    if (state.run_id.includes("mind")) return true;
  }
  return false;
}

function checkExplicitOrchestrator(state: Readonly<Record<string, unknown>>): boolean {
  if (state.orchestrator !== undefined && state.orchestrator !== null && state.orchestrator !== false) return true;
  if (typeof state.run_id === "string") {
    if (state.run_id.includes("orchestrator")) return true;
  }
  return false;
}

export function auditCompanionAuditors(
  options: CompanionAuditorDoctorOptions = {},
): readonly DoctorDiagnosticFinding[] {
  const findings: DoctorDiagnosticFinding[] = [];
  const repoRoot = options.repoRoot;
  let isMandatory = true;
  if (repoRoot !== undefined) {
    isMandatory = SkillAuditorPolicy.isMandatoryTarget(repoRoot);
  }

  const state = options.state;
  let activeGrants: readonly AgentGrantRecord[] = [];

  if (Array.isArray(options.grants)) {
    activeGrants = options.grants.filter(
      (g): g is AgentGrantRecord =>
        typeof g === "object" &&
        g !== null &&
        "role" in g &&
        (g as AgentGrantRecord).status === "active",
    );
  } else if (state !== undefined && state !== null && isJsonObject(state)) {
    try {
      const rawLedger = readAgentLedger(state);
      activeGrants = rawLedger.filter((g) => g.status === "active");
    } catch {
      activeGrants = [];
    }
    if (activeGrants.length === 0) {
      if (Array.isArray(state.agents)) {
        activeGrants = (state.agents as AgentGrantRecord[]).filter(
          (g) =>
            typeof g === "object" &&
            g !== null &&
            (g as Record<string, unknown>).status === "active",
        );
      } else if (Array.isArray(state.grants)) {
        activeGrants = (state.grants as AgentGrantRecord[]).filter(
          (g) =>
            typeof g === "object" &&
            g !== null &&
            (g as Record<string, unknown>).status === "active",
        );
      }
    }
  }

  const hasMindGrant = activeGrants.some((g) => {
    const roleVal: unknown = g.role;
    return isMindRole(roleVal, g.id);
  });

  const hasOrchestratorGrant = activeGrants.some((g) => {
    const roleVal: unknown = g.role;
    const isOrchRole = roleVal === "orchestrator";
    const hasOrchId = typeof g.id === "string" ? g.id.includes("orchestrator") : false;
    return isOrchRole ? true : hasOrchId;
  });

  let isExplicitMind = false;
  let isExplicitOrchestrator = false;
  if (state !== undefined && state !== null && isJsonObject(state)) {
    isExplicitMind = checkExplicitMind(state);
    isExplicitOrchestrator = checkExplicitOrchestrator(state);
  }

  const isMindCapsule = isExplicitMind ? true : hasMindGrant;
  const isOrchestratorCapsule = isExplicitOrchestrator ? true : hasOrchestratorGrant;

  let hasOnlyWorkerGrants = false;
  if (activeGrants.length > 0) {
    if (hasMindGrant === false) {
      if (hasOrchestratorGrant === false) {
        hasOnlyWorkerGrants = true;
      }
    }
  }

  const hasMindAuditor = activeGrants.some((g) => {
    const roleVal: unknown = g.role;
    return isMindAuditorRole(roleVal, g.id);
  });

  const hasSkillAuditor = activeGrants.some((g) => {
    const roleVal: unknown = g.role;
    return isSkillAuditorRole(roleVal, g.id);
  });

  let requiresMindAuditor = false;
  if (isMandatory) {
    if (hasOnlyWorkerGrants) {
      requiresMindAuditor = false;
    } else if (state !== undefined && state !== null) {
      requiresMindAuditor = isMindCapsule;
    } else {
      requiresMindAuditor = isMindCapsule ? true : activeGrants.length === 0;
    }
  }

  let requiresSkillAuditor = false;
  if (isMandatory) {
    if (hasOnlyWorkerGrants) {
      requiresSkillAuditor = false;
    } else if (state !== undefined && state !== null) {
      if (isMindCapsule) {
        requiresSkillAuditor = true;
      } else if (isOrchestratorCapsule) {
        requiresSkillAuditor = true;
      }
    } else {
      if (isMindCapsule) {
        requiresSkillAuditor = true;
      } else if (isOrchestratorCapsule) {
        requiresSkillAuditor = true;
      } else if (activeGrants.length === 0) {
        requiresSkillAuditor = true;
      }
    }
  }

  if (hasMindAuditor === false && requiresMindAuditor === true) {
    findings.push({
      code: "MISSING_MIND_AUDITOR",
      severity: "ERROR",
      engine: "checkCompanionAuditors",
      message:
        "Mandatory companion auditor 'mind-auditor' is not deployed or active in the agent ledger. Tier 0 Mind requires an active mind-auditor companion to audit stagnation, candidate admission, and supervisory health.",
      details: {
        role: "mind-auditor",
        mandatory: true,
        repoRoot,
      },
    });
  }

  if (hasSkillAuditor === false && requiresSkillAuditor === true) {
    findings.push({
      code: "MISSING_SKILL_AUDITOR",
      severity: "ERROR",
      engine: "checkCompanionAuditors",
      message:
        "Mandatory companion auditor 'skill-auditor' is not deployed or active in the agent ledger. Tier 1 Orchestrator requires an active skill-auditor companion to audit skill compliance, false serialization, and role boundary violations.",
      details: {
        role: "skill-auditor",
        mandatory: true,
        repoRoot,
      },
    });
  }

  const mindAuditors = activeGrants.filter((g) => {
    const roleVal: unknown = g.role;
    if (roleVal === "mind-auditor") return true;
    if (roleVal === "meta-auditor") return true;
    return false;
  });
  if (mindAuditors.length > 1) {
    if (options.strict === true) {
      findings.push({
        code: "DUPLICATE_MIND_AUDITOR",
        severity: "ERROR",
        engine: "checkCompanionAuditors",
        message: `Multiple active mind-auditor grants detected (${mindAuditors.map((g) => g.id).join(", ")}). Singleton auditor invariant mandates exactly one active instance.`,
        details: {
          count: mindAuditors.length,
          agentIds: mindAuditors.map((g) => g.id),
        },
      });
    } else {
      findings.push({
        code: "COMPANION_AUDITOR_CONFLICT",
        severity: "WARN",
        engine: "checkCompanionAuditors",
        message: `Multiple active mind-auditor grants detected (${mindAuditors.map((g) => g.id).join(", ")}). Singleton auditor invariant recommends exactly one active instance.`,
        details: {
          count: mindAuditors.length,
          agentIds: mindAuditors.map((g) => g.id),
        },
      });
    }
  }

  const skillAuditors = activeGrants.filter((g) => {
    const roleVal: unknown = g.role;
    if (roleVal === "skill-auditor") return true;
    if (roleVal === "meta-auditor") return true;
    return false;
  });
  if (skillAuditors.length > 1) {
    if (options.strict === true) {
      findings.push({
        code: "DUPLICATE_SKILL_AUDITOR",
        severity: "ERROR",
        engine: "checkCompanionAuditors",
        message: `Multiple active skill-auditor grants detected (${skillAuditors.map((g) => g.id).join(", ")}). Singleton auditor invariant mandates exactly one active instance.`,
        details: {
          count: skillAuditors.length,
          agentIds: skillAuditors.map((g) => g.id),
        },
      });
    } else {
      findings.push({
        code: "COMPANION_AUDITOR_CONFLICT",
        severity: "WARN",
        engine: "checkCompanionAuditors",
        message: `Multiple active skill-auditor grants detected (${skillAuditors.map((g) => g.id).join(", ")}). Singleton auditor invariant recommends exactly one active instance.`,
        details: {
          count: skillAuditors.length,
          agentIds: skillAuditors.map((g) => g.id),
        },
      });
    }
  }

  return findings;
}

export function checkCompanionAuditorsDoctor(
  options: CompanionAuditorDoctorOptions = {},
): DoctorCheckEngineResult {
  const findings = auditCompanionAuditors(options);
  const hasErrors = findings.some((f) => f.severity === "ERROR");
  return {
    engine: "checkCompanionAuditors",
    passed: hasErrors === false,
    findings,
  };
}

export function isCompanionAuditorCompliant(options: CompanionAuditorDoctorOptions = {}): boolean {
  const findings = auditCompanionAuditors(options);
  const hasErrors = findings.some((f) => f.severity === "ERROR");
  return hasErrors === false;
}

export function assertCompanionAuditorsDoctor(options: CompanionAuditorDoctorOptions = {}): void {
  const findings = auditCompanionAuditors(options);
  const errorFinding = findings.find((f) => f.severity === "ERROR");
  if (errorFinding !== undefined) {
    throw new HarnessError(
      "INTEGRITY",
      `[DOCTOR_COMPANION_AUDITOR_VIOLATION] ${errorFinding.message}`,
    );
  }
}
