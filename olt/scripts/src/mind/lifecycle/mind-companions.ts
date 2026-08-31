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

export function createMandatoryMindCompanionGrants(
  mindId: string,
  options?: { host?: string | undefined; now?: string | undefined },
): AgentGrantRecord[] {
  const nowIso = options?.now ?? new Date().toISOString();
  const host = options?.host ?? "initialization";

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
  const resultGrants = [...initialGrants];
  const hasMindAuditor = resultGrants.some(
    (g) =>
      (g.role as string) === "mind-auditor" ||
      (g.role as string) === "meta-auditor" ||
      g.id.includes("mind-auditor"),
  );
  const hasSkillAuditor = resultGrants.some(
    (g) =>
      (g.role as string) === "skill-auditor" ||
      (g.role as string) === "meta-auditor" ||
      g.id.includes("skill-auditor"),
  );

  const companionGrants = createMandatoryMindCompanionGrants(mindId, options);

  if (!hasMindAuditor) {
    const mindAuditor = companionGrants.find((g) => g.role === "mind-auditor");
    if (mindAuditor) resultGrants.push(mindAuditor);
  }
  if (!hasSkillAuditor) {
    const skillAuditor = companionGrants.find((g) => g.role === "skill-auditor");
    if (skillAuditor) resultGrants.push(skillAuditor);
  }

  return resultGrants;
}

export function deployMandatoryMindCompanions(
  mindId: string,
  options?: MindCompanionDeploymentOptions,
): MindCompanionDeploymentResult {
  const nowIso = options?.now ?? new Date().toISOString();
  const host = options?.host ?? "initialization";
  const companionGrants = createMandatoryMindCompanionGrants(mindId, { host, now: nowIso });

  if (options?.runRoot) {
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

  const mindAuditor = companionGrants.find((g) => g.role === "mind-auditor")!;
  const skillAuditor = companionGrants.find((g) => g.role === "skill-auditor")!;

  return {
    deployed: true,
    deployedGrants: companionGrants,
    mindAuditorId: mindAuditor.id,
    skillAuditorId: skillAuditor.id,
    timestamp: nowIso,
  };
}

export function verifyMindCompanionBootstrapping(activeAgents: readonly AgentGrantRecord[]): {
  readonly mindAuditorPresent: boolean;
  readonly skillAuditorPresent: boolean;
  readonly complete: boolean;
  readonly missing: readonly string[];
} {
  const mindAuditorPresent = activeAgents.some(
    (a) =>
      a.status === "active" &&
      ((a.role as string) === "mind-auditor" || (a.role as string) === "meta-auditor"),
  );
  const skillAuditorPresent = activeAgents.some(
    (a) =>
      a.status === "active" &&
      ((a.role as string) === "skill-auditor" || (a.role as string) === "meta-auditor"),
  );

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
  if (repoRoot && !SkillAuditorPolicy.isMandatoryTarget(repoRoot)) {
    return;
  }
  const verification = verifyMindCompanionBootstrapping(activeAgents);
  if (!verification.complete) {
    throw new HarnessError(
      "INVALID_STATE",
      `[MANDATORY_COMPANION_AUDITORS_VIOLATION] Missing mandatory companion auditor(s): ${verification.missing.join(", ")}. Both mind-auditor and skill-auditor must be deployed and active alongside Tier 0 Mind.`,
    );
  }
}
