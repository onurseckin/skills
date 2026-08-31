import { HarnessError } from "../../core/errors/index.ts";
import {
  type AuditorLeaseLock,
  DEFAULT_AUDITOR_LOCK_FILE,
  defaultIsPidAlive,
  normalizeAuditorRole,
  readAuditorLeaseLock,
} from "./singleton-auditor-guard.ts";
import {
  agentIdToRole,
  agentIdToTier,
  roleToTier,
  validateTierSpawning,
  type ExecutionTier,
} from "../thread/index.ts";

export {
  type AuditorLeaseLock,
  DEFAULT_AUDITOR_LOCK_FILE,
  defaultIsPidAlive,
  normalizeAuditorRole,
  readAuditorLeaseLock,
};

export const DEFAULT_SINGLETON_AUDITOR_ROLE = "skill_auditor";
export const DUPLICATE_SINGLETON_AUDITOR_MESSAGE =
  "DUPLICATE_SINGLETON_AUDITOR_ERROR: Active skill auditor already running";

export function isSingletonAuditorRole(role: string): boolean {
  const norm = normalizeAuditorRole(role);
  return (
    norm === "skill-auditor" ||
    norm === "meta-auditor" ||
    norm === "mind-auditor" ||
    norm === "singleton-auditor" ||
    norm === "auditor"
  );
}

export interface SubagentSpawnRequest {
  readonly role: string;
  readonly name?: string | undefined;
  readonly subagent_id?: string | undefined;
  readonly conversation_id?: string | undefined;
  readonly target_tier?: number | string | undefined;
  readonly requested_by?: string | undefined;
  readonly parent_tier?: number | undefined;
}

export interface SubagentSpawnValidationResult {
  readonly allowed: boolean;
  readonly role: string;
  readonly reason?: string | undefined;
  readonly active_lease?: AuditorLeaseLock | null | undefined;
}

export interface SpawnValidatorOptions {
  readonly customLockPath?: string | undefined;
  readonly isPidAliveFn?: ((pid: number) => boolean) | undefined;
  readonly activeLeaseReader?: ((lockPath?: string) => AuditorLeaseLock | null) | undefined;
  readonly now?: Date | string | number | undefined;
}

function parseTimestampMs(now?: Date | string | number): number {
  if (now === undefined || now === null) return Date.now();
  if (typeof now === "number") return Number.isFinite(now) ? now : Date.now();
  if (now instanceof Date) return now.getTime();
  const parsed = Date.parse(now);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

export function validateSubagentSpawnRequest(
  request: SubagentSpawnRequest,
  options?: SpawnValidatorOptions,
): SubagentSpawnValidationResult {
  if (!request || typeof request !== "object" || typeof request.role !== "string") {
    return {
      allowed: false,
      role: typeof request?.role === "string" ? request.role : "unknown",
      reason: "INVALID_ARGUMENT: Subagent spawn request must contain a valid string role",
      active_lease: null,
    };
  }

  const role = request.role;
  const normalizedRole = normalizeAuditorRole(role);

  // If tier context is provided, validate tier spawning hierarchy
  if (request.parent_tier !== undefined || request.requested_by !== undefined) {
    const parentTier =
      request.parent_tier ??
      (request.requested_by
        ? (roleToTier(agentIdToRole(request.requested_by) ?? request.requested_by) ??
          agentIdToTier(request.requested_by) ??
          0)
        : 0);
    const childTier = (
      typeof request.target_tier === "number"
        ? request.target_tier
        : (roleToTier(role) ?? agentIdToTier(request.subagent_id ?? role) ?? 3)
    ) as ExecutionTier;

    const tierResult = validateTierSpawning(
      parentTier as ExecutionTier,
      childTier,
      request.requested_by,
      role,
    );
    if (!tierResult.allowed) {
      return {
        allowed: false,
        role,
        reason: tierResult.reason ?? "ROLE_CONFINEMENT_VIOLATION: Invalid tier spawning hierarchy",
        active_lease: null,
      };
    }
  }

  if (!isSingletonAuditorRole(normalizedRole)) {
    return {
      allowed: true,
      role,
      active_lease: null,
    };
  }

  const leaseReader = options?.activeLeaseReader ?? readAuditorLeaseLock;
  const lease = leaseReader(options?.customLockPath);

  if (!lease) {
    return {
      allowed: true,
      role,
      active_lease: null,
    };
  }

  const isPidAlive = options?.isPidAliveFn ?? defaultIsPidAlive;
  const pidAlive = isPidAlive(lease.pid);

  const nowMs = parseTimestampMs(options?.now);
  const expiresAtMs = Date.parse(lease.lease_expires_at);
  const isExpired = Number.isNaN(expiresAtMs) || expiresAtMs <= nowMs;

  if (pidAlive && !isExpired) {
    return {
      allowed: false,
      role,
      reason: DUPLICATE_SINGLETON_AUDITOR_MESSAGE,
      active_lease: lease,
    };
  }

  return {
    allowed: true,
    role,
    active_lease: null,
  };
}

export function rejectDuplicateAuditorSpawn(
  request: SubagentSpawnRequest,
  options?: SpawnValidatorOptions,
): void {
  const result = validateSubagentSpawnRequest(request, options);
  if (!result.allowed) {
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      result.reason ?? DUPLICATE_SINGLETON_AUDITOR_MESSAGE,
    );
  }
}
