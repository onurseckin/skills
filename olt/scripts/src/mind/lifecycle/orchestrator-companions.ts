import type { AgentGrantRecord } from "../../core/contracts/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { SkillAuditorPolicy } from "../../engine/scheduler/index.ts";
import {
  acquireAuditorLeaseLock,
  defaultIsPidAlive,
  readAuditorLeaseLock,
  type AuditorLeaseLock,
} from "../../authority/guards/index.ts";
import { inferRoleFromAgentId, normalizeRoleName } from "../../authority/thread/index.ts";
import { readListenerHeartbeat } from "../../communication/mailbox/index.ts";
import type { LiveSubagentInfo } from "./ghost-reconciler.ts";

export const MANDATORY_ORCHESTRATOR_COMPANION_ROLE = "skill-auditor";

export interface EnsureOrchestratorCompanionOptions {
  readonly orchestratorId?: string | undefined;
  readonly runRoot?: string | undefined;
  readonly repoRoot?: string | undefined;
  readonly host?: string | undefined;
  readonly now?: string | undefined;
  readonly subagents?: readonly LiveSubagentInfo[] | undefined;
  readonly activeGrants?: readonly AgentGrantRecord[] | undefined;
  readonly mailboxCheck?: boolean | undefined;
  readonly customLockPath?: string | undefined;
  readonly isPidAliveFn?: ((pid: number) => boolean) | undefined;
  readonly wakeFn?: ((auditorId: string) => void) | undefined;
  readonly deployFn?: ((grant: AgentGrantRecord) => void) | undefined;
  readonly deduplicateFn?: ((revokedAuditorId: string) => void) | undefined;
}

export interface EnsureOrchestratorCompanionResult {
  readonly paired: boolean;
  readonly action: "deployed" | "woken" | "reconnected" | "noop";
  readonly auditorId: string;
  readonly role: "skill-auditor";
  readonly grant: AgentGrantRecord;
  readonly deduplicatedCount: number;
  readonly timestamp: string;
  readonly reconnected: boolean;
  readonly lock?: AuditorLeaseLock | undefined;
}

export interface AssertOrchestratorCompanionOptions {
  readonly orchestratorId?: string | undefined;
  readonly activeGrants?: readonly AgentGrantRecord[] | undefined;
  readonly subagents?: readonly LiveSubagentInfo[] | undefined;
  readonly repoRoot?: string | undefined;
  readonly strict?: boolean | undefined;
}

export interface VerifyOrchestratorCompanionResult {
  readonly paired: boolean;
  readonly auditorCount: number;
  readonly auditorIds: readonly string[];
  readonly isMandatoryTarget: boolean;
  readonly issues: readonly string[];
}

export function isSkillAuditorEntity(roleOrId: string | undefined): boolean {
  if (roleOrId === undefined) {
    return false;
  }
  if (typeof roleOrId !== "string") {
    return false;
  }
  const clean = roleOrId.trim().toLowerCase().replace(/_/gu, "-");
  if (clean === "skill-auditor") {
    return true;
  }
  if (clean === "meta-auditor") {
    return true;
  }
  if (clean.endsWith("-skill-auditor")) {
    return true;
  }
  if (clean.includes("skill-auditor")) {
    return true;
  }
  const normalized = normalizeRoleName(roleOrId);
  if (normalized === "skill-auditor") {
    return true;
  }
  const inferred = inferRoleFromAgentId(roleOrId);
  if (inferred === "skill-auditor") {
    return true;
  }
  return false;
}

function isAuditorGrantActive(g: AgentGrantRecord): boolean {
  if (g.status !== "active") {
    return false;
  }
  if (isSkillAuditorEntity(g.role)) {
    return true;
  }
  if (isSkillAuditorEntity(g.id)) {
    return true;
  }
  return false;
}

function isSubagentAuditor(s: LiveSubagentInfo): boolean {
  if (isSkillAuditorEntity(s.role)) {
    return true;
  }
  if (isSkillAuditorEntity(s.subagent_id)) {
    return true;
  }
  return false;
}

function isSubagentRunning(s: LiveSubagentInfo, isAliveFn: (pid: number) => boolean): boolean {
  if (s.status === "stopped") {
    return false;
  }
  if (s.status === "terminated") {
    return false;
  }
  if (s.status === "paused") {
    return false;
  }
  if (s.status === "sleeping") {
    return false;
  }
  if (s.pid > 0) {
    if (isAliveFn(s.pid)) {
      return true;
    }
  }
  return s.status === "active";
}

function isAssertOptions(
  input: readonly AgentGrantRecord[] | AssertOrchestratorCompanionOptions,
): input is AssertOrchestratorCompanionOptions {
  return !Array.isArray(input);
}

export function verifyOrchestratorCompanionPairing(
  activeAgentsOrOptions: readonly AgentGrantRecord[] | AssertOrchestratorCompanionOptions,
  repoRoot?: string,
): VerifyOrchestratorCompanionResult {
  let activeGrants: readonly AgentGrantRecord[] = [];
  let subagents: readonly LiveSubagentInfo[] = [];
  let resolvedRepoRoot = repoRoot;

  if (Array.isArray(activeAgentsOrOptions)) {
    activeGrants = activeAgentsOrOptions;
  } else if (isAssertOptions(activeAgentsOrOptions)) {
    if (activeAgentsOrOptions.activeGrants !== undefined) {
      activeGrants = activeAgentsOrOptions.activeGrants;
    }
    if (activeAgentsOrOptions.subagents !== undefined) {
      subagents = activeAgentsOrOptions.subagents;
    }
    if (activeAgentsOrOptions.repoRoot !== undefined) {
      resolvedRepoRoot = activeAgentsOrOptions.repoRoot;
    }
  }

  const isMandatory =
    resolvedRepoRoot !== undefined ? SkillAuditorPolicy.isMandatoryTarget(resolvedRepoRoot) : true;

  const foundIds: string[] = [];
  for (const g of activeGrants) {
    if (isAuditorGrantActive(g)) {
      if (!foundIds.includes(g.id)) {
        foundIds.push(g.id);
      }
    }
  }
  for (const s of subagents) {
    if (s.status !== "stopped") {
      if (s.status !== "terminated") {
        if (isSubagentAuditor(s)) {
          if (!foundIds.includes(s.subagent_id)) {
            foundIds.push(s.subagent_id);
          }
        }
      }
    }
  }

  const issues: string[] = [];
  if (foundIds.length === 0) {
    if (isMandatory) {
      issues.push(
        "Missing mandatory companion skill-auditor. Exactly one companion skill-auditor must be paired and active alongside Orchestrator.",
      );
    }
  } else if (foundIds.length > 1) {
    issues.push(
      `Multiple active companion skill-auditors detected (${foundIds.join(", ")}). Tier 1 Orchestrator enforces a singleton skill-auditor invariant.`,
    );
  }

  let paired = false;
  if (!isMandatory) {
    if (foundIds.length === 0) {
      paired = true;
    }
  }
  if (foundIds.length === 1) {
    paired = true;
  }

  return {
    paired,
    auditorCount: foundIds.length,
    auditorIds: foundIds,
    isMandatoryTarget: isMandatory,
    issues,
  };
}

export function assertOrchestratorCompanionPairing(
  activeAgentsOrOptions: readonly AgentGrantRecord[] | AssertOrchestratorCompanionOptions,
  repoRoot?: string,
): void {
  const verification = verifyOrchestratorCompanionPairing(activeAgentsOrOptions, repoRoot);
  if (verification.issues.length > 0) {
    if (verification.auditorCount > 1) {
      throw new HarnessError(
        "INVALID_STATE",
        `[DUPLICATE_SKILL_AUDITOR_VIOLATION] ${verification.issues.join(" ")}`,
      );
    }
    throw new HarnessError(
      "INVALID_STATE",
      `[ORCHESTRATOR_COMPANION_PAIRING_VIOLATION] ${verification.issues.join(" ")}`,
    );
  }
}

export function ensureOrchestratorCompanionAuditor(
  orchestratorIdOrOptions?: string | EnsureOrchestratorCompanionOptions,
  maybeOptions?: EnsureOrchestratorCompanionOptions,
): EnsureOrchestratorCompanionResult {
  let orchId = "orchestrator";
  let opts: EnsureOrchestratorCompanionOptions = {};

  if (typeof orchestratorIdOrOptions === "string") {
    if (orchestratorIdOrOptions.trim().length > 0) {
      orchId = orchestratorIdOrOptions.trim();
    }
    if (maybeOptions !== undefined) {
      opts = maybeOptions;
    }
  } else if (typeof orchestratorIdOrOptions === "object") {
    if (orchestratorIdOrOptions !== null) {
      opts = orchestratorIdOrOptions;
      if (opts.orchestratorId !== undefined) {
        if (opts.orchestratorId.trim().length > 0) {
          orchId = opts.orchestratorId.trim();
        }
      }
    }
  }

  let nowIso = new Date().toISOString();
  if (opts.now !== undefined) {
    if (opts.now.trim().length > 0) {
      nowIso = opts.now.trim();
    }
  }

  let host = "orchestration";
  if (opts.host !== undefined) {
    if (opts.host.trim().length > 0) {
      host = opts.host.trim();
    }
  }

  const isAliveFn = opts.isPidAliveFn !== undefined ? opts.isPidAliveFn : defaultIsPidAlive;

  const collectedIds: string[] = [];
  const inactiveIds: string[] = [];

  const activeGrants = opts.activeGrants !== undefined ? opts.activeGrants : [];
  for (const g of activeGrants) {
    if (isSkillAuditorEntity(g.role)) {
      if (g.status === "active") {
        if (!collectedIds.includes(g.id)) {
          collectedIds.push(g.id);
        }
      } else if (!inactiveIds.includes(g.id)) {
        inactiveIds.push(g.id);
      }
    } else if (isSkillAuditorEntity(g.id)) {
      if (g.status === "active") {
        if (!collectedIds.includes(g.id)) {
          collectedIds.push(g.id);
        }
      } else if (!inactiveIds.includes(g.id)) {
        inactiveIds.push(g.id);
      }
    }
  }

  const subagents = opts.subagents !== undefined ? opts.subagents : [];
  for (const s of subagents) {
    if (isSubagentAuditor(s)) {
      if (isSubagentRunning(s, isAliveFn)) {
        if (!collectedIds.includes(s.subagent_id)) {
          collectedIds.push(s.subagent_id);
        }
      } else if (!inactiveIds.includes(s.subagent_id)) {
        inactiveIds.push(s.subagent_id);
      }
    }
  }

  let existingLock: AuditorLeaseLock | null = null;
  // 3. Check Mailbox Liveness if enabled and no auditor found yet
  if (collectedIds.length === 0) {
    if (inactiveIds.length === 0) {
      if (opts.mailboxCheck === true) {
        if (opts.runRoot !== undefined) {
          const candidates = [`${orchId}-skill-auditor`, "skill_auditor"];
          for (const cid of candidates) {
            try {
              const hb = readListenerHeartbeat(cid, opts.runRoot);
              if (hb !== null) {
                if (hb.pid > 0) {
                  if (isAliveFn(hb.pid)) {
                    if (!collectedIds.includes(cid)) {
                      collectedIds.push(cid);
                    }
                    break;
                  }
                }
              }
            } catch {}
          }
        }
      }

      // 4. Check Singleton Lease Lock on disk
      let shouldCheckDiskLock = false;
      if (opts.customLockPath !== undefined) {
        shouldCheckDiskLock = true;
      } else if (opts.activeGrants === undefined) {
        if (opts.subagents === undefined) {
          shouldCheckDiskLock = true;
        }
      }

      if (shouldCheckDiskLock) {
        existingLock = readAuditorLeaseLock(opts.customLockPath);
        if (existingLock !== null) {
          if (isAliveFn(existingLock.pid)) {
            const expiresAtMs = Date.parse(existingLock.lease_expires_at);
            if (!Number.isNaN(expiresAtMs)) {
              if (expiresAtMs > Date.now()) {
                if (!collectedIds.includes(existingLock.auditor_id)) {
                  collectedIds.push(existingLock.auditor_id);
                }
              }
            }
          }
        }
      }
    }
  }

  // Active auditor(s) present: deduplicate & reconnect
  if (collectedIds.length > 0) {
    const primaryId = collectedIds[0] !== undefined ? collectedIds[0] : `${orchId}-skill-auditor`;
    let deduplicatedCount = 0;
    if (collectedIds.length > 1) {
      deduplicatedCount = collectedIds.length - 1;
      for (let i = 1; i < collectedIds.length; i++) {
        const dupId = collectedIds[i];
        if (dupId !== undefined) {
          if (opts.deduplicateFn !== undefined) {
            opts.deduplicateFn(dupId);
          }
        }
      }
    }
    const grant: AgentGrantRecord = {
      id: primaryId,
      role: "skill-auditor",
      parent_agent_id: orchId,
      parent_task_id: null,
      host,
      granted_at: nowIso,
      status: "active",
    };
    return {
      paired: true,
      action: "reconnected",
      auditorId: primaryId,
      role: "skill-auditor",
      grant,
      deduplicatedCount,
      timestamp: nowIso,
      reconnected: true,
      lock: existingLock !== null ? existingLock : undefined,
    };
  }

  // Auditor exists but is inactive / sleeping: wake it!
  if (inactiveIds.length > 0) {
    const auditorId = inactiveIds[0] !== undefined ? inactiveIds[0] : `${orchId}-skill-auditor`;
    if (opts.wakeFn !== undefined) {
      opts.wakeFn(auditorId);
    }
    const grant: AgentGrantRecord = {
      id: auditorId,
      role: "skill-auditor",
      parent_agent_id: orchId,
      parent_task_id: null,
      host,
      granted_at: nowIso,
      status: "active",
    };
    return {
      paired: true,
      action: "woken",
      auditorId,
      role: "skill-auditor",
      grant,
      deduplicatedCount: 0,
      timestamp: nowIso,
      reconnected: true,
    };
  }

  // Absent: deploy exactly ONE companion skill_auditor with singleton guard
  const targetAuditorId = `${orchId}-skill-auditor`;
  let leaseLock: AuditorLeaseLock | undefined = undefined;

  try {
    leaseLock = acquireAuditorLeaseLock({
      auditor_id: targetAuditorId,
      host_type: host,
      customLockPath: opts.customLockPath,
      isPidAliveFn: isAliveFn,
    });
  } catch {
    const collisionLock = readAuditorLeaseLock(opts.customLockPath);
    if (collisionLock !== null) {
      const reconnectedGrant: AgentGrantRecord = {
        id: collisionLock.auditor_id,
        role: "skill-auditor",
        parent_agent_id: orchId,
        parent_task_id: null,
        host: collisionLock.host_type,
        granted_at: collisionLock.acquired_at,
        status: "active",
      };
      return {
        paired: true,
        action: "reconnected",
        auditorId: collisionLock.auditor_id,
        role: "skill-auditor",
        grant: reconnectedGrant,
        deduplicatedCount: 1,
        timestamp: nowIso,
        reconnected: true,
        lock: collisionLock,
      };
    }
  }

  const deployedGrant: AgentGrantRecord = {
    id: targetAuditorId,
    role: "skill-auditor",
    parent_agent_id: orchId,
    parent_task_id: null,
    host,
    granted_at: nowIso,
    status: "active",
  };

  if (opts.deployFn !== undefined) {
    opts.deployFn(deployedGrant);
  }

  return {
    paired: true,
    action: "deployed",
    auditorId: targetAuditorId,
    role: "skill-auditor",
    grant: deployedGrant,
    deduplicatedCount: 0,
    timestamp: nowIso,
    reconnected: false,
    lock: leaseLock,
  };
}
