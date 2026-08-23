/**
 * @fileoverview Robust Lease Agent Extractor for reporting and telemetry surfaces.
 * Eliminates undefined/null artifacts when parsing agent assignments from task leases.
 */

export interface LeaseRecordView {
  agent_id?: string | undefined;
  agent?: string | undefined;
  role?: string | undefined;
  attempt?: number | undefined;
  issued_at?: string | undefined;
  expires_at?: string | undefined;
  heartbeat_at?: string | undefined;
  duration_seconds?: number | undefined;
  token_digest?: string | undefined;
}

/**
 * Extracts and normalizes the agent identifier from a task lease object.
 * Safely handles legacy \`agent\` vs modern \`agent_id\` property definitions,
 * trims trailing/leading whitespace, and filters out literal "undefined"/"null" strings.
 */
export function extractLeaseAgentId(lease: unknown): string {
  if (!lease || typeof lease !== "object") return "";
  const rec = lease as Record<string, unknown>;
  if (
    typeof rec.agent_id === "string" &&
    rec.agent_id.trim().length > 0 &&
    rec.agent_id !== "undefined" &&
    rec.agent_id !== "null"
  ) {
    return rec.agent_id.trim();
  }
  if (
    typeof rec.agent === "string" &&
    rec.agent.trim().length > 0 &&
    rec.agent !== "undefined" &&
    rec.agent !== "null"
  ) {
    return rec.agent.trim();
  }
  return "";
}

/**
 * Extracts and normalizes the role associated with a lease.
 */
export function extractLeaseRole(lease: unknown, defaultRole: string = "implementer"): string {
  if (!lease || typeof lease !== "object") return defaultRole;
  const rec = lease as Record<string, unknown>;
  if (typeof rec.role === "string" && rec.role.trim().length > 0) {
    return rec.role.trim();
  }
  return defaultRole;
}

/**
 * Extracts the attempt counter associated with a lease.
 */
export function extractLeaseAttempt(lease: unknown): number {
  if (!lease || typeof lease !== "object") return 1;
  const rec = lease as Record<string, unknown>;
  if (typeof rec.attempt === "number" && Number.isFinite(rec.attempt) && rec.attempt > 0) {
    return Math.floor(rec.attempt);
  }
  return 1;
}
