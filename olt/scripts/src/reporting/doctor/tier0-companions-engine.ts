import type { AgentGrantRecord, JsonObject } from "../../core/contracts/index.ts";
import { readAgentLedger } from "../../workflow/agents/ledger.ts";
import type { DoctorCheckEngineResult, DoctorDiagnosticFinding } from "./types.ts";

export interface Tier0CompanionsCheckOptions {
  readonly state?: Readonly<Record<string, unknown>> | null | undefined;
  readonly repoRoot?: string | undefined;
}

export function checkTier0CompanionsHealth(
  options: Tier0CompanionsCheckOptions = {},
): DoctorCheckEngineResult {
  const state = options.state;
  const findings: DoctorDiagnosticFinding[] = [];

  if (!state) {
    return {
      engine: "checkTier0CompanionsHealth",
      passed: true,
      findings: [],
    };
  }

  const isMindCapsule =
    Boolean(state.mind) ||
    Boolean(state.pulse) ||
    (typeof state.run_id === "string" && state.run_id.includes("mind"));

  if (!isMindCapsule) {
    return {
      engine: "checkTier0CompanionsHealth",
      passed: true,
      findings: [],
    };
  }

  let grants: readonly AgentGrantRecord[] = [];
  try {
    grants = readAgentLedger(state as unknown as JsonObject);
  } catch {
    if (Array.isArray(state.agents)) {
      grants = state.agents as AgentGrantRecord[];
    } else if (Array.isArray(state.grants)) {
      grants = state.grants as AgentGrantRecord[];
    }
  }

  if (grants.length === 0) {
    if (Array.isArray(state.agents)) {
      grants = state.agents as AgentGrantRecord[];
    } else if (Array.isArray(state.grants)) {
      grants = state.grants as AgentGrantRecord[];
    }
  }

  const activeGrants = grants.filter((g) => g.status === "active");

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

  if (!hasMindAuditor) {
    findings.push({
      code: "MISSING_MIND_AUDITOR_COMPANION",
      severity: "ERROR",
      engine: "checkTier0CompanionsHealth",
      message:
        "Tier 0 Mind capsule is missing an active 'mind-auditor' companion. Mind Auditor is mandatory and must remain permanently active to continuously audit liveness, candidate admissions, and stagnation.",
      details: { role: "mind-auditor", activeGrantsCount: activeGrants.length },
    });
  }

  if (!hasSkillAuditor) {
    findings.push({
      code: "MISSING_SKILL_AUDITOR_COMPANION",
      severity: "ERROR",
      engine: "checkTier0CompanionsHealth",
      message:
        "Tier 0 Mind capsule is missing an active 'skill-auditor' companion. Skill Auditor is mandatory and must remain permanently active to continuously audit skill compliance, behavioral efficiency, and dual-channel UI proofs.",
      details: { role: "skill-auditor", activeGrantsCount: activeGrants.length },
    });
  }

  const pulseState = (state.pulse ?? {}) as Record<string, unknown>;
  const consecutiveZeroDelta =
    typeof pulseState.consecutive_zero_delta === "number" ? pulseState.consecutive_zero_delta : 0;

  if (consecutiveZeroDelta >= 2) {
    findings.push({
      code: "CHRONIC_IDLE_STAGNATION_DETECTED",
      severity: "WARN",
      engine: "checkTier0CompanionsHealth",
      message: `Mind has registered ${consecutiveZeroDelta} consecutive idle / zero-delta pulses. Mind must execute Mode A Autonomous Self-Evolution via 'bun harness.ts mind:self-evolve'.`,
      details: { consecutiveZeroDelta },
    });
  }

  const hasErrors = findings.some((f) => f.severity === "ERROR");

  return {
    engine: "checkTier0CompanionsHealth",
    passed: !hasErrors,
    findings,
  };
}
