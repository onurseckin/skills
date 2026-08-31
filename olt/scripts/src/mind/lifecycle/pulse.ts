import type { AgentGrantRecord } from "../../core/contracts/index.ts";
import { isJsonObject } from "../../core/contracts/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { SkillAuditorPolicy } from "../../engine/scheduler/index.ts";
import { readAgentLedger } from "../../workflow/agents/ledger.ts";
import { MANDATORY_MIND_COMPANION_AUDITORS, type MindCompanionAuditorRole } from "./mind-init.ts";

export interface CompanionAuditorPulseCheck {
  readonly role: MindCompanionAuditorRole;
  readonly present: boolean;
  readonly agentId?: string | undefined;
  readonly healthy: boolean;
  readonly status: "active" | "missing" | "unhealthy";
  readonly reason?: string | undefined;
}

export interface PulseCompanionAuditorVerificationResult {
  readonly verified: boolean;
  readonly timestamp: string;
  readonly checks: readonly CompanionAuditorPulseCheck[];
  readonly mindAuditorPresent: boolean;
  readonly skillAuditorPresent: boolean;
  readonly allHealthy: boolean;
  readonly issues: readonly string[];
}

export interface PulseCompanionAuditorOptions {
  readonly repoRoot?: string | undefined;
  readonly strict?: boolean | undefined;
  readonly now?: string | undefined;
}

export function extractActiveGrants(
  activeAgentsOrState: readonly AgentGrantRecord[] | Readonly<Record<string, unknown>>,
): readonly AgentGrantRecord[] {
  if (Array.isArray(activeAgentsOrState)) {
    return activeAgentsOrState as readonly AgentGrantRecord[];
  }
  if (isJsonObject(activeAgentsOrState)) {
    return readAgentLedger(activeAgentsOrState);
  }
  return [];
}

export function verifyPulseCompanionAuditors(
  activeAgentsOrState: readonly AgentGrantRecord[] | Readonly<Record<string, unknown>>,
  options?: PulseCompanionAuditorOptions,
): PulseCompanionAuditorVerificationResult {
  const nowIso = options?.now ?? new Date().toISOString();
  const grants = extractActiveGrants(activeAgentsOrState);
  const activeGrants = grants.filter((g) => g.status === "active");

  const mindAuditorGrant = activeGrants.find(
    (g) =>
      (g.role as string) === "mind-auditor" ||
      (g.role as string) === "meta-auditor" ||
      g.id.includes("mind-auditor"),
  );

  const skillAuditorGrant = activeGrants.find(
    (g) =>
      (g.role as string) === "skill-auditor" ||
      (g.role as string) === "meta-auditor" ||
      g.id.includes("skill-auditor"),
  );

  const mindAuditorPresent = mindAuditorGrant !== undefined;
  const skillAuditorPresent = skillAuditorGrant !== undefined;

  const checks: CompanionAuditorPulseCheck[] = [
    {
      role: "mind-auditor",
      present: mindAuditorPresent,
      agentId: mindAuditorGrant?.id,
      healthy: mindAuditorPresent,
      status: mindAuditorPresent ? "active" : "missing",
      reason: mindAuditorPresent
        ? undefined
        : "Mandatory mind-auditor companion is not active in the agent ledger",
    },
    {
      role: "skill-auditor",
      present: skillAuditorPresent,
      agentId: skillAuditorGrant?.id,
      healthy: skillAuditorPresent,
      status: skillAuditorPresent ? "active" : "missing",
      reason: skillAuditorPresent
        ? undefined
        : "Mandatory skill-auditor companion is not active in the agent ledger",
    },
  ];

  const issues: string[] = [];
  if (!mindAuditorPresent) {
    issues.push("Mind companion auditor 'mind-auditor' is missing or inactive.");
  }
  if (!skillAuditorPresent) {
    issues.push("Skill companion auditor 'skill-auditor' is missing or inactive.");
  }

  const allHealthy = mindAuditorPresent && skillAuditorPresent;
  const verified = allHealthy;

  return {
    verified,
    timestamp: nowIso,
    checks,
    mindAuditorPresent,
    skillAuditorPresent,
    allHealthy,
    issues,
  };
}

export function assertPulseCompanionAuditors(
  activeAgentsOrState: readonly AgentGrantRecord[] | Readonly<Record<string, unknown>>,
  options?: PulseCompanionAuditorOptions,
): void {
  const repoRoot = options?.repoRoot;
  const isMandatory =
    repoRoot !== undefined ? SkillAuditorPolicy.isMandatoryTarget(repoRoot) : true;
  const isStrict = options?.strict === true || isMandatory;

  if (!isStrict) return;

  const result = verifyPulseCompanionAuditors(activeAgentsOrState, options);
  if (!result.verified) {
    throw new HarnessError(
      "INVALID_STATE",
      `[MIND_PULSE_COMPANION_AUDITORS_VIOLATION] Pulse supervisory cadence check failed: ${result.issues.join(" ")} Both mind-auditor and skill-auditor companions must be deployed and active during Mind pulse operations.`,
    );
  }
}

export function formatPulseCompanionBrief(
  verification: PulseCompanionAuditorVerificationResult,
): string {
  const badge = verification.verified ? "✅ HEALTHY" : "❌ DEGRADED";
  const lines: string[] = [
    `### Companion Auditors Supervision (${badge})`,
    `- **Mind Auditor**: ${verification.mindAuditorPresent ? "✅ Active" : "❌ Missing"}`,
    `- **Skill Auditor**: ${verification.skillAuditorPresent ? "✅ Active" : "❌ Missing"}`,
    `- **All Healthy**: ${verification.allHealthy ? "Yes" : "No"}`,
    `- **Timestamp**: ${verification.timestamp}`,
  ];
  if (verification.issues.length > 0) {
    lines.push("#### Issues:");
    for (const issue of verification.issues) {
      lines.push(`- ${issue}`);
    }
  }
  return lines.join("\n");
}
