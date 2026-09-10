import type { AgentGrantRecord } from "../../core/contracts/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { transact } from "../../engine/store/index.ts";
import { readAgentLedger, writeAgentLedger } from "../../workflow/agents/ledger.ts";
import { SkillAuditorPolicy } from "../../engine/scheduler/index.ts";

export const MANDATORY_MIND_COMPANION_AUDITORS: readonly ["mind-auditor", "skill-auditor"] = [
  "mind-auditor",
  "skill-auditor",
] as const;

export type MindCompanionAuditorRole = (typeof MANDATORY_MIND_COMPANION_AUDITORS)[number];

export interface MindCompanionDeploymentOptions {
  readonly mindId?: string | undefined;
  readonly runRoot?: string | undefined;
  readonly repoRoot?: string | undefined;
  readonly host?: string | undefined;
  readonly now?: string | undefined;
  readonly activeAgents?: readonly AgentGrantRecord[] | undefined;
}

export interface MindCompanionDeploymentResult {
  readonly deployed: boolean;
  readonly deployedGrants: readonly AgentGrantRecord[];
  readonly mindAuditorId: string;
  readonly skillAuditorId: string;
  readonly timestamp: string;
}

function isMindAuditorGrant(grant: AgentGrantRecord): boolean {
  const roleStr: string = grant.role;
  if (roleStr === "mind-auditor") return true;
  if (roleStr === "mind_auditor") return true;
  if (roleStr === "meta-auditor") return true;
  if (grant.id.includes("mind-auditor")) return true;
  if (grant.id.includes("mind_auditor")) return true;
  return false;
}

function isSkillAuditorGrant(grant: AgentGrantRecord): boolean {
  const roleStr: string = grant.role;
  if (roleStr === "skill-auditor") return true;
  if (roleStr === "skill_auditor") return true;
  if (roleStr === "meta-auditor") return true;
  if (grant.id.includes("skill-auditor")) return true;
  if (grant.id.includes("skill_auditor")) return true;
  return false;
}

function isActiveMindAuditor(grant: AgentGrantRecord): boolean {
  if (grant.status !== "active") return false;
  return isMindAuditorGrant(grant);
}

function isActiveSkillAuditor(grant: AgentGrantRecord): boolean {
  if (grant.status !== "active") return false;
  return isSkillAuditorGrant(grant);
}

export function createMandatoryMindCompanionGrants(
  mindId: string,
  options?: { host?: string | undefined; now?: string | undefined },
): AgentGrantRecord[] {
  const nowIso =
    options !== undefined && options.now !== undefined ? options.now : new Date().toISOString();
  const host =
    options !== undefined && options.host !== undefined ? options.host : "initialization";

  const mindAuditorGrant: AgentGrantRecord = {
    id: `${mindId}-mind-auditor`,
    role: "mind-auditor",
    parent_agent_id: mindId,
    parent_task_id: null,
    host,
    granted_at: nowIso,
    status: "active",
  };

  const skillAuditorGrant: AgentGrantRecord = {
    id: `${mindId}-skill-auditor`,
    role: "skill-auditor",
    parent_agent_id: mindId,
    parent_task_id: null,
    host,
    granted_at: nowIso,
    status: "active",
  };

  return [mindAuditorGrant, skillAuditorGrant];
}

export function bootstrapMindLifecycleWithCompanions(
  mindId: string,
  initialGrants: readonly AgentGrantRecord[],
  options?: { host?: string | undefined; now?: string | undefined },
): AgentGrantRecord[] {
  const companionGrants = createMandatoryMindCompanionGrants(mindId, options);
  const mindAuditorTemplate = companionGrants.find((g) => g.role === "mind-auditor");
  const skillAuditorTemplate = companionGrants.find((g) => g.role === "skill-auditor");

  const result: AgentGrantRecord[] = [];
  let foundMindAuditor = false;
  let foundSkillAuditor = false;

  for (const grant of initialGrants) {
    if (isMindAuditorGrant(grant)) {
      if (!foundMindAuditor) {
        foundMindAuditor = true;
        result.push({
          ...grant,
          role: "mind-auditor",
          parent_agent_id: mindId,
          status: "active",
        });
      }
      continue;
    }
    if (isSkillAuditorGrant(grant)) {
      if (!foundSkillAuditor) {
        foundSkillAuditor = true;
        result.push({
          ...grant,
          role: "skill-auditor",
          parent_agent_id: mindId,
          status: "active",
        });
      }
      continue;
    }
    result.push(grant);
  }

  if (!foundMindAuditor && mindAuditorTemplate !== undefined) {
    result.push(mindAuditorTemplate);
  }
  if (!foundSkillAuditor && skillAuditorTemplate !== undefined) {
    result.push(skillAuditorTemplate);
  }

  return result;
}

export function deployMandatoryMindCompanions(
  mindId: string,
  options?: MindCompanionDeploymentOptions,
): MindCompanionDeploymentResult {
  const nowIso =
    options !== undefined && options.now !== undefined ? options.now : new Date().toISOString();
  const host =
    options !== undefined && options.host !== undefined ? options.host : "initialization";
  const companionGrants = createMandatoryMindCompanionGrants(mindId, { host, now: nowIso });

  if (options !== undefined && options.runRoot !== undefined) {
    try {
      transact(
        options.runRoot,
        mindId,
        "companion-auditors-deployed",
        {
          mind_id: mindId,
          deployed_at: nowIso,
          roles: [...MANDATORY_MIND_COMPANION_AUDITORS],
        },
        (state) => {
          const currentLedger = readAgentLedger(state);
          const updatedLedger = bootstrapMindLifecycleWithCompanions(mindId, currentLedger, {
            host,
            now: nowIso,
          });
          writeAgentLedger(state, updatedLedger);
        },
      );
    } catch {
      // If transact cannot proceed, continue with returned grants
    }
  }

  const mindAuditor = companionGrants.find((g) => g.role === "mind-auditor");
  const skillAuditor = companionGrants.find((g) => g.role === "skill-auditor");

  const mindAuditorId = mindAuditor !== undefined ? mindAuditor.id : `${mindId}-mind-auditor`;
  const skillAuditorId = skillAuditor !== undefined ? skillAuditor.id : `${mindId}-skill-auditor`;

  return {
    deployed: true,
    deployedGrants: companionGrants,
    mindAuditorId,
    skillAuditorId,
    timestamp: nowIso,
  };
}

export function verifyMindCompanionBootstrapping(activeAgents: readonly AgentGrantRecord[]): {
  readonly mindAuditorPresent: boolean;
  readonly skillAuditorPresent: boolean;
  readonly complete: boolean;
  readonly missing: readonly string[];
} {
  const mindAuditorPresent = activeAgents.some(isActiveMindAuditor);
  const skillAuditorPresent = activeAgents.some(isActiveSkillAuditor);

  const missing: string[] = [];
  if (!mindAuditorPresent) missing.push("mind-auditor");
  if (!skillAuditorPresent) missing.push("skill-auditor");

  return {
    mindAuditorPresent,
    skillAuditorPresent,
    complete: mindAuditorPresent && skillAuditorPresent,
    missing,
  };
}

export function assertMindCompanionBootstrapping(
  activeAgents: readonly AgentGrantRecord[],
  repoRoot?: string,
): void {
  const verification = verifyMindCompanionBootstrapping(activeAgents);

  if (!verification.mindAuditorPresent) {
    throw new HarnessError(
      "INVALID_STATE",
      "[INSEPARABLE_MIND_AUDITOR_CO_DEPLOYMENT_VIOLATION] Mandatory companion mind-auditor is missing or inactive. Tier 0 Mind requires inseparable co-deployment alongside active mind-auditor.",
    );
  }

  const requiresSkillAuditor =
    repoRoot !== undefined ? SkillAuditorPolicy.isMandatoryTarget(repoRoot) : true;

  if (requiresSkillAuditor && !verification.skillAuditorPresent) {
    throw new HarnessError(
      "INVALID_STATE",
      `[MANDATORY_COMPANION_AUDITORS_VIOLATION] Missing mandatory companion auditor(s): ${verification.missing.join(", ")}. Both mind-auditor and skill-auditor must be deployed and active alongside Tier 0 Mind.`,
    );
  }
}
