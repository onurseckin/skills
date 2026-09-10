import { existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { AgentGrantRecord, JsonObject } from "../../core/contracts/index.ts";
import { isJsonObject } from "../../core/contracts/index.ts";
import { findRepoRoot } from "../../core/shared/index.ts";
import {
  computeDoctorEnginePassed,
  type DoctorCheckEngineResult,
  type DoctorDiagnosticFinding,
} from "./types.ts";

const req = createRequire(import.meta.url);

function getReadAgentLedger(): (state: JsonObject) => AgentGrantRecord[] {
  const mod = req("../../workflow/agents/index.ts") as {
    readonly readAgentLedger: (state: JsonObject) => AgentGrantRecord[];
  };
  return mod.readAgentLedger;
}

export interface Tier0CompanionsCheckOptions {
  readonly state?: Readonly<Record<string, unknown>> | null | undefined;
  readonly repoRoot?: string | undefined;
}

function checkIsMindCapsule(state: Readonly<Record<string, unknown>>): boolean {
  if (state.mind !== undefined && state.mind !== null && state.mind !== false) return true;
  if (state.pulse !== undefined && state.pulse !== null && state.pulse !== false) return true;
  if (typeof state.run_id === "string") {
    if (state.run_id.includes("mind")) return true;
  }
  return false;
}

export function checkTier0CompanionsHealth(
  options: Tier0CompanionsCheckOptions = {},
): DoctorCheckEngineResult {
  const state = options.state;
  const findings: DoctorDiagnosticFinding[] = [];

  if (state === undefined) {
    return {
      engine: "checkTier0CompanionsHealth",
      passed: true,
      findings: [],
    };
  }
  if (state === null) {
    return {
      engine: "checkTier0CompanionsHealth",
      passed: true,
      findings: [],
    };
  }

  const isMindCapsule = checkIsMindCapsule(state);

  if (isMindCapsule === false) {
    return {
      engine: "checkTier0CompanionsHealth",
      passed: true,
      findings: [],
    };
  }

  let grants: readonly AgentGrantRecord[] = [];
  try {
    grants = getReadAgentLedger()(state as unknown as JsonObject);
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

  const hasMindAuditor = activeGrants.some((g) => {
    const roleVal: unknown = g.role;
    if (roleVal === "mind-auditor") return true;
    if (roleVal === "meta-auditor") return true;
    if (g.id.includes("mind-auditor")) return true;
    return false;
  });

  const hasSkillAuditor = activeGrants.some((g) => {
    const roleVal: unknown = g.role;
    if (roleVal === "skill-auditor") return true;
    if (roleVal === "meta-auditor") return true;
    if (g.id.includes("skill-auditor")) return true;
    return false;
  });

  if (hasMindAuditor === false) {
    findings.push({
      code: "MISSING_MIND_AUDITOR_COMPANION",
      severity: "ERROR",
      engine: "checkTier0CompanionsHealth",
      message:
        "Tier 0 Mind capsule is missing an active 'mind-auditor' companion. Mind Auditor is mandatory and must remain permanently active to continuously audit liveness, candidate admissions, and stagnation.",
      details: { role: "mind-auditor", activeGrantsCount: activeGrants.length },
    });
  }

  if (hasSkillAuditor === false) {
    findings.push({
      code: "MISSING_SKILL_AUDITOR_COMPANION",
      severity: "ERROR",
      engine: "checkTier0CompanionsHealth",
      message:
        "Tier 0 Mind capsule is missing an active 'skill-auditor' companion. Skill Auditor is mandatory and must remain permanently active to continuously audit skill compliance, behavioral efficiency, and dual-channel UI proofs.",
      details: { role: "skill-auditor", activeGrantsCount: activeGrants.length },
    });
  }

  const mindAuditors = activeGrants.filter((g) => {
    const roleVal: unknown = g.role;
    if (roleVal === "mind-auditor") return true;
    if (roleVal === "meta-auditor") return true;
    return false;
  });
  if (mindAuditors.length > 1) {
    findings.push({
      code: "MULTIPLE_MIND_AUDITORS_DETECTED",
      severity: "ERROR",
      engine: "checkTier0CompanionsHealth",
      message: `Tier 0 Mind capsule has ${mindAuditors.length} active 'mind-auditor' companions. Mind Auditor must be a singleton.`,
      details: { count: mindAuditors.length, agentIds: mindAuditors.map((g) => g.id) },
    });
  }

  const skillAuditors = activeGrants.filter((g) => {
    const roleVal: unknown = g.role;
    if (roleVal === "skill-auditor") return true;
    if (roleVal === "meta-auditor") return true;
    return false;
  });
  if (skillAuditors.length > 1) {
    findings.push({
      code: "MULTIPLE_SKILL_AUDITORS_DETECTED",
      severity: "ERROR",
      engine: "checkTier0CompanionsHealth",
      message: `Tier 0 Mind capsule has ${skillAuditors.length} active 'skill-auditor' companions. Skill Auditor must be a singleton.`,
      details: { count: skillAuditors.length, agentIds: skillAuditors.map((g) => g.id) },
    });
  }

  let pulseState: Record<string, unknown> = {};
  if (isJsonObject(state.pulse)) {
    pulseState = state.pulse;
  }
  const consecutiveZeroDelta =
    typeof pulseState.consecutive_zero_delta === "number" ? pulseState.consecutive_zero_delta : 0;

  let isStagnant = false;
  if (consecutiveZeroDelta >= 2) {
    isStagnant = true;
  } else if (pulseState.stagnation_alarm_bypassed === true) {
    isStagnant = true;
  } else if (pulseState.alarm_bypassed === true) {
    isStagnant = true;
  }

  if (isStagnant) {
    findings.push({
      code: "CHRONIC_IDLE_STAGNATION_DETECTED",
      severity: "WARN",
      engine: "checkTier0CompanionsHealth",
      message: `Mind has registered ${consecutiveZeroDelta} consecutive idle / zero-delta pulses or stagnation alarm was bypassed. Mind must execute Mode A Autonomous Self-Evolution via 'bun harness.ts mind:self-evolve'.`,
      details: {
        consecutiveZeroDelta,
        stagnationAlarmBypassed: pulseState.stagnation_alarm_bypassed === true,
      },
    });
  }

  let rawInterval: unknown = undefined;
  if (pulseState.interval !== undefined) {
    rawInterval = pulseState.interval;
  } else if (pulseState.cron !== undefined) {
    rawInterval = pulseState.cron;
  }
  if (rawInterval !== undefined && rawInterval !== null) {
    const interval = String(rawInterval);
    if (interval !== "5m" && interval !== "15m") {
      findings.push({
        code: "INVALID_MIND_CADENCE_INTERVAL",
        severity: "WARN",
        engine: "checkTier0CompanionsHealth",
        message: `Mind scheduled interval '${interval}' does not match expected 5m or 15m cadence.`,
        details: { interval },
      });
    }
  }

  let repoRoot = options.repoRoot;
  if (repoRoot === undefined) {
    try {
      repoRoot = findRepoRoot();
    } catch {
      repoRoot = process.cwd();
    }
  } else if (repoRoot === "") {
    try {
      repoRoot = findRepoRoot();
    } catch {
      repoRoot = process.cwd();
    }
  }

  const mindCharter = join(repoRoot, "olt/agents/mind.yaml");
  const mindAuditorCharter = join(repoRoot, "olt/agents/mind-auditor.yaml");
  const missingCharters: string[] = [];

  if (existsSync(mindCharter) === false) {
    missingCharters.push("olt/agents/mind.yaml");
  }
  if (existsSync(mindAuditorCharter) === false) {
    missingCharters.push("olt/agents/mind-auditor.yaml");
  }

  if (missingCharters.length > 0) {
    findings.push({
      code: "MISSING_MIND_POLICY_CHARTER",
      severity: "ERROR",
      engine: "checkTier0CompanionsHealth",
      message: `Required Mind policy charter(s) missing: ${missingCharters.join(", ")}.`,
      details: { missingCharters },
    });
  }

  return {
    engine: "checkTier0CompanionsHealth",
    passed: computeDoctorEnginePassed(findings),
    findings,
  };
}
