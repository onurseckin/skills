import { normalizeAgentRole } from "./matrix.ts";

export const AUDITOR_ALREADY_ACTIVE_REUSED = "AUDITOR_ALREADY_ACTIVE_REUSED" as const;

export const COMPANION_AUDITOR_ROLES = [
  "mind-auditor",
  "skill-auditor",
  "independent-planner-auditor",
] as const;

export type CompanionAuditorRole = (typeof COMPANION_AUDITOR_ROLES)[number];

export const REUSABLE_AUDITOR_STATUSES: readonly string[] = ["active", "running", "idle"] as const;

export interface ActiveAuditorRecord {
  readonly id: string;
  readonly role: string;
  readonly status: string;
  readonly parent_agent_id?: string | null;
  readonly parentTaskId?: string | null;
  readonly sessionId?: string;
  readonly host?: string;
  readonly granted_at?: string;
  readonly startedAt?: number;
  readonly lastHeartbeatAt?: number;
  readonly hasError?: boolean;
  readonly error?: string | null;
  readonly health?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CompanionScopingOptions {
  readonly sessionId?: string | undefined;
  readonly host?: string | undefined;
  readonly scope?: "session" | "global" | undefined;
  readonly now?: number | undefined;
  readonly maxStaleHeartbeatMs?: number | undefined;
}

export interface AuditorReuseNotice {
  readonly code: typeof AUDITOR_ALREADY_ACTIVE_REUSED;
  readonly message: string;
  readonly existingAuditorId: string;
  readonly role: string;
  readonly timestamp: string;
}

export type PreflightCheckResult =
  | {
      readonly action: "reuse";
      readonly role: string;
      readonly existingAuditor: ActiveAuditorRecord;
      readonly notice: AuditorReuseNotice;
    }
  | {
      readonly action: "spawn";
      readonly role: string;
      readonly existingAuditor?: undefined;
      readonly notice?: undefined;
    };

export interface BatchPreflightResult {
  readonly allAuditors: readonly {
    readonly role: string;
    readonly auditorId?: string;
    readonly action: "reuse" | "spawn";
  }[];
  readonly reused: readonly ActiveAuditorRecord[];
  readonly toSpawn: readonly string[];
  readonly notices: readonly AuditorReuseNotice[];
  readonly hasDuplicatesAverted: boolean;
}

export type DeploymentExecutionResult =
  | {
      readonly action: "reuse";
      readonly instance: ActiveAuditorRecord;
      readonly notice: AuditorReuseNotice;
    }
  | {
      readonly action: "spawn";
      readonly instance: ActiveAuditorRecord;
      readonly notice?: undefined;
    };

export function normalizeAuditorRole(role: string): string {
  const trimmed = role.trim().toLowerCase().replace(/_/g, "-");
  if (trimmed === "meta-auditor") return "mind-auditor";
  return normalizeAgentRole(trimmed);
}

export function isCompanionAuditorRole(role: string): boolean {
  const normalized = normalizeAuditorRole(role);
  return (COMPANION_AUDITOR_ROLES as readonly string[]).includes(normalized);
}

export function isAuditorStatusReusable(status?: string | null): boolean {
  if (!status) return false;
  return REUSABLE_AUDITOR_STATUSES.includes(status.trim().toLowerCase());
}

export function isAuditorHealthy(
  record: ActiveAuditorRecord,
  options?: CompanionScopingOptions,
): boolean {
  if (!isAuditorStatusReusable(record.status)) return false;
  if (
    record.hasError === true ||
    (record.error !== null && record.error !== undefined && record.error !== "")
  ) {
    return false;
  }
  if (
    record.health !== null &&
    record.health !== undefined &&
    record.health.trim().toLowerCase() !== "healthy"
  ) {
    return false;
  }
  if (
    options?.maxStaleHeartbeatMs !== null &&
    options?.maxStaleHeartbeatMs !== undefined &&
    record.lastHeartbeatAt !== null &&
    record.lastHeartbeatAt !== undefined
  ) {
    const now = options.now ?? Date.now();
    if (now - record.lastHeartbeatAt > options.maxStaleHeartbeatMs) {
      return false;
    }
  }
  return true;
}

export function selectCanonicalAuditor(
  candidates: readonly ActiveAuditorRecord[],
): ActiveAuditorRecord {
  if (candidates.length === 0) {
    throw new Error("No candidate auditors to select from.");
  }
  if (candidates.length === 1) {
    return candidates[0]!;
  }
  const sorted = [...candidates].sort((a, b) => {
    const timeA = a.startedAt ?? (a.granted_at ? new Date(a.granted_at).getTime() : 0);
    const timeB = b.startedAt ?? (b.granted_at ? new Date(b.granted_at).getTime() : 0);
    if (timeB !== timeA) {
      return timeB - timeA;
    }
    return a.id.localeCompare(b.id);
  });
  return sorted[0]!;
}

export function filterEligibleAuditors(
  normalizedRole: string,
  activeFleet: readonly ActiveAuditorRecord[],
  options?: CompanionScopingOptions,
): readonly ActiveAuditorRecord[] {
  return activeFleet.filter((record) => {
    if (normalizeAuditorRole(record.role) !== normalizedRole) return false;
    if (options?.scope === "session" && options.sessionId) {
      if (record.sessionId !== options.sessionId) return false;
    }
    if (options?.host && record.host && record.host !== options.host) {
      return false;
    }
    return isAuditorHealthy(record, options);
  });
}

export function checkAuditorPreflight(
  requestedRole: string,
  activeFleet: readonly ActiveAuditorRecord[],
  options?: CompanionScopingOptions,
): PreflightCheckResult {
  const normalizedRole = normalizeAuditorRole(requestedRole);
  const eligible = filterEligibleAuditors(normalizedRole, activeFleet, options);

  if (eligible.length > 0) {
    const canonical = selectCanonicalAuditor(eligible);
    const nowIso = new Date(options?.now ?? Date.now()).toISOString();
    return {
      action: "reuse",
      role: normalizedRole,
      existingAuditor: canonical,
      notice: {
        code: AUDITOR_ALREADY_ACTIVE_REUSED,
        message: `[AUDITOR_ALREADY_ACTIVE_REUSED] Active companion auditor of type '${normalizedRole}' already running (${canonical.id}). Reusing existing instance instead of spawning duplicate.`,
        existingAuditorId: canonical.id,
        role: normalizedRole,
        timestamp: nowIso,
      },
    };
  }

  return {
    action: "spawn",
    role: normalizedRole,
  };
}

export function preflightCompanionAuditorDeployment(
  requestedRoles: readonly string[],
  activeFleet: readonly ActiveAuditorRecord[],
  options?: CompanionScopingOptions,
): BatchPreflightResult {
  const reused: ActiveAuditorRecord[] = [];
  const toSpawn: string[] = [];
  const notices: AuditorReuseNotice[] = [];
  const allAuditors: { role: string; auditorId?: string; action: "reuse" | "spawn" }[] = [];

  const matchedIds = new Set<string>();

  for (const role of requestedRoles) {
    const availableFleet = activeFleet.filter((rec) => !matchedIds.has(rec.id));
    const preflight = checkAuditorPreflight(role, availableFleet, options);

    if (preflight.action === "reuse") {
      matchedIds.add(preflight.existingAuditor.id);
      reused.push(preflight.existingAuditor);
      notices.push(preflight.notice);
      allAuditors.push({
        role: preflight.role,
        auditorId: preflight.existingAuditor.id,
        action: "reuse",
      });
    } else {
      toSpawn.push(preflight.role);
      allAuditors.push({
        role: preflight.role,
        action: "spawn",
      });
    }
  }

  return {
    allAuditors,
    reused,
    toSpawn,
    notices,
    hasDuplicatesAverted: reused.length > 0,
  };
}

export function validateCompanionAuditorSpawn(
  _parentRole: string,
  childRole: string,
  activeFleet: readonly ActiveAuditorRecord[],
  options?: CompanionScopingOptions,
): {
  readonly allowed: boolean;
  readonly action: "spawn" | "reuse" | "rejected";
  readonly existingAuditor?: ActiveAuditorRecord;
  readonly violation?: string;
  readonly notice?: AuditorReuseNotice;
} {
  const normalizedChild = normalizeAuditorRole(childRole);
  if (!isCompanionAuditorRole(normalizedChild)) {
    return {
      allowed: false,
      action: "rejected",
      violation: `Role '${childRole}' is not a recognized companion auditor.`,
    };
  }

  const preflight = checkAuditorPreflight(normalizedChild, activeFleet, options);
  if (preflight.action === "reuse") {
    return {
      allowed: false,
      action: "reuse",
      existingAuditor: preflight.existingAuditor,
      notice: preflight.notice,
      violation: `Companion auditor '${normalizedChild}' is already active (${preflight.existingAuditor.id}). Duplicate spawn blocked.`,
    };
  }

  return {
    allowed: true,
    action: "spawn",
  };
}

function buildCoordinatorKey(role: string, options?: CompanionScopingOptions): string {
  if (options?.scope === "session" && options.sessionId) {
    return `session:${options.sessionId}:${role}`;
  }
  return `global:${role}`;
}

export class CompanionDeploymentCoordinator {
  private readonly pendingSpawns = new Map<string, Promise<ActiveAuditorRecord>>();
  private readonly registry: ActiveAuditorRecord[] = [];

  public getRegisteredAuditors(): readonly ActiveAuditorRecord[] {
    return [...this.registry];
  }

  public registerActiveAuditor(auditor: ActiveAuditorRecord): void {
    const sanitized: ActiveAuditorRecord = {
      ...auditor,
      role: normalizeAuditorRole(auditor.role),
      parent_agent_id: null,
    };
    this.registry.push(sanitized);
  }

  public async deployCompanion(
    role: string,
    spawnFn: (normalizedRole: string) => Promise<ActiveAuditorRecord>,
    options?: CompanionScopingOptions,
  ): Promise<DeploymentExecutionResult> {
    const normalizedRole = normalizeAuditorRole(role);
    if (!isCompanionAuditorRole(normalizedRole)) {
      throw new Error(
        `[ROLE_CONFINEMENT_VIOLATION] '${role}' is not a recognized companion auditor archetype.`,
      );
    }

    const preflight = checkAuditorPreflight(normalizedRole, this.registry, options);
    if (preflight.action === "reuse") {
      return {
        action: "reuse",
        instance: preflight.existingAuditor,
        notice: preflight.notice,
      };
    }

    const key = buildCoordinatorKey(normalizedRole, options);
    let pending = this.pendingSpawns.get(key);

    if (!pending) {
      pending = (async () => {
        try {
          const raw = await spawnFn(normalizedRole);
          const sanitized: ActiveAuditorRecord = {
            ...raw,
            role: normalizedRole,
            parent_agent_id: null,
          };
          this.registry.push(sanitized);
          return sanitized;
        } finally {
          this.pendingSpawns.delete(key);
        }
      })();

      this.pendingSpawns.set(key, pending);
      const instance = await pending;
      return {
        action: "spawn",
        instance,
      };
    }

    const instance = await pending;
    const nowIso = new Date(options?.now ?? Date.now()).toISOString();
    return {
      action: "reuse",
      instance,
      notice: {
        code: AUDITOR_ALREADY_ACTIVE_REUSED,
        message: `[AUDITOR_ALREADY_ACTIVE_REUSED] Concurrent companion auditor '${normalizedRole}' completed. Reusing instance (${instance.id}).`,
        existingAuditorId: instance.id,
        role: normalizedRole,
        timestamp: nowIso,
      },
    };
  }
}
