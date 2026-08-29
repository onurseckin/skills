import { HarnessError } from "../../core/errors/index.ts";
import {
  type AuditorLeaseLock,
  DEFAULT_AUDITOR_LOCK_FILE,
  defaultIsPidAlive,
  readAuditorLeaseLock,
} from "./singleton-auditor-guard.ts";

export {
  type AuditorLeaseLock,
  DEFAULT_AUDITOR_LOCK_FILE,
  defaultIsPidAlive,
  readAuditorLeaseLock,
};

export const DEFAULT_SINGLETON_AUDITOR_ROLE = "skill_auditor";
export const DUPLICATE_SINGLETON_AUDITOR_MESSAGE =
  "DUPLICATE_SINGLETON_AUDITOR_ERROR: Active skill auditor already running";

export interface SubagentSpawnRequest {
  readonly role: string;
  readonly name?: string | undefined;
  readonly subagent_id?: string | undefined;
  readonly conversation_id?: string | undefined;
  readonly target_tier?: number | string | undefined;
  readonly requested_by?: string | undefined;
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
  const normalizedRole = role.trim().toLowerCase();
  if (normalizedRole !== DEFAULT_SINGLETON_AUDITOR_ROLE) {
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
