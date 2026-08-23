import type { JsonObject } from "../../contracts/json.ts";
import { HarnessError } from "../../errors/harness-error.ts";

export const LEASE_SUSPENDED_AT = "suspended_at";

export function isLeaseSuspended(lease: JsonObject): boolean {
  return typeof lease[LEASE_SUSPENDED_AT] === "string";
}

export function suspendLease(lease: JsonObject, at: Date): void {
  if (isLeaseSuspended(lease)) {
    throw new HarnessError("INVALID_STATE", "lease clock is already suspended");
  }
  lease[LEASE_SUSPENDED_AT] = at.toISOString();
}

export function restoreLease(lease: JsonObject, at: Date, durationSeconds: number): void {
  if (!isLeaseSuspended(lease)) {
    throw new HarnessError("INVALID_STATE", "lease clock is not suspended");
  }
  delete lease[LEASE_SUSPENDED_AT];
  lease.expires_at = new Date(at.valueOf() + durationSeconds * 1_000).toISOString();
  if (typeof lease.heartbeat_at === "string") lease.heartbeat_at = at.toISOString();
}

export function leaseIsExpired(lease: JsonObject, now: Date, graceMs = 0): boolean {
  if (isLeaseSuspended(lease)) return false;
  const expiresAt = lease.expires_at;
  if (typeof expiresAt !== "string") return false;
  const deadline = Date.parse(expiresAt);
  return Number.isFinite(deadline) && deadline + graceMs <= now.valueOf();
}
