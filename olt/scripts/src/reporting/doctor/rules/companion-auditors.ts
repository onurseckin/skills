import type { AgentGrantRecord } from "../../../core/contracts/index.ts";
import { isJsonObject } from "../../../core/contracts/index.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import { SkillAuditorPolicy } from "../../../engine/scheduler/index.ts";
import { readAgentLedger } from "../../../workflow/agents/ledger.ts";
import type { DoctorCheckEngineResult, DoctorDiagnosticFinding } from "../types.ts";

export interface CompanionAuditorDoctorOptions {
  readonly repoRoot?: string | undefined;
  readonly state?: Readonly<Record<string, unknown>> | null | undefined;
  readonly grants?: readonly unknown[] | null | undefined;
  readonly events?: readonly unknown[] | null | undefined;
  readonly strict?: boolean | undefined;
}

export function auditCompanionAuditors(
  options: CompanionAuditorDoctorOptions = {},
): readonly DoctorDiagnosticFinding[] {
  const findings: DoctorDiagnosticFinding[] = [];
  const repoRoot = options.repoRoot;
  const isMandatory =
    repoRoot !== undefined ? SkillAuditorPolicy.isMandatoryTarget(repoRoot) : true;

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
  } else if (state && isJsonObject(state)) {
    const rawLedger = readAgentLedger(state);
    activeGrants = rawLedger.filter((g) => g.status === "active");
  }

  const hasMindAuditor = activeGrants.some(
    (g) =>
      (g.role as string) === "mind-auditor" ||
      (g.role as string) === "meta-auditor" ||
      g.id.includes("mind-auditor"),
  );

  const hasSkillAuditor = activeGrants.some(
    (g) =>
      (g.role as string) === "skill-auditor" ||
      (g.role as string) === "meta-auditor" ||
      g.id.includes("skill-auditor"),
  );

  if (!hasMindAuditor && isMandatory) {
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

  if (!hasSkillAuditor && isMandatory) {
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

  const mindAuditors = activeGrants.filter(
    (g) => (g.role as string) === "mind-auditor" || (g.role as string) === "meta-auditor",
  );
  if (mindAuditors.length > 1) {
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

  const skillAuditors = activeGrants.filter(
    (g) => (g.role as string) === "skill-auditor" || (g.role as string) === "meta-auditor",
  );
  if (skillAuditors.length > 1) {
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

  return findings;
}

export function checkCompanionAuditorsDoctor(
  options: CompanionAuditorDoctorOptions = {},
): DoctorCheckEngineResult {
  const findings = auditCompanionAuditors(options);
  const hasErrors = findings.some((f) => f.severity === "ERROR");
  return {
    engine: "checkCompanionAuditors",
    passed: !hasErrors,
    findings,
  };
}

export function isCompanionAuditorCompliant(
  options: CompanionAuditorDoctorOptions = {},
): boolean {
  const findings = auditCompanionAuditors(options);
  return !findings.some((f) => f.severity === "ERROR");
}

export function assertCompanionAuditorsDoctor(
  options: CompanionAuditorDoctorOptions = {},
): void {
  const findings = auditCompanionAuditors(options);
  const errorFinding = findings.find((f) => f.severity === "ERROR");
  if (errorFinding) {
    throw new HarnessError(
      "INTEGRITY",
      `[DOCTOR_COMPANION_AUDITOR_VIOLATION] ${errorFinding.message}`,
    );
  }
}
