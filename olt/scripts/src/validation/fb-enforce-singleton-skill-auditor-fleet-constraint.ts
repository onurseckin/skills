import { HarnessError } from "../core/errors/harness-error.ts";

export type AuditorStatus = "active" | "idle" | "stale" | "terminated";

export interface FleetAuditorRecord {
  readonly auditor_id: string;
  readonly role: "skill_auditor" | string;
  readonly orchestrator_id: string;
  readonly pid: number;
  readonly status: AuditorStatus;
  readonly started_at: string;
  readonly heartbeat_at: string;
  readonly lease_expires_at?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface FleetOrchestratorState {
  readonly orchestrator_id: string;
  readonly auditors: readonly FleetAuditorRecord[];
  readonly status?: "active" | "draining" | "stopped" | undefined;
  readonly active_tiers?: readonly string[] | undefined;
  readonly last_synced_at?: string | undefined;
}

export interface FleetAuditorConfig {
  readonly max_skill_auditors: number;
  readonly heartbeat_ttl_ms: number;
  readonly lease_duration_ms: number;
  readonly allowed_roles: readonly string[];
  readonly enforce_singleton: boolean;
}

export const DEFAULT_FLEET_CONFIG: FleetAuditorConfig = {
  max_skill_auditors: 1,
  heartbeat_ttl_ms: 60_000,
  lease_duration_ms: 300_000,
  allowed_roles: ["skill_auditor"],
  enforce_singleton: true,
};

export class FleetAuditorConstraintViolationError extends HarnessError {
  public readonly conflictingAuditors: readonly FleetAuditorRecord[];

  public constructor(message: string, conflictingAuditors: readonly FleetAuditorRecord[] = [], fix?: string) {
    super(
      "ROLE_CONFINEMENT_VIOLATION",
      message,
      conflictingAuditors.map((a) => ({
        auditor_id: a.auditor_id,
        role: a.role,
        orchestrator_id: a.orchestrator_id,
        pid: a.pid,
        status: a.status,
      })),
      3,
      fix ?? "Terminate duplicate skill_auditor instances to enforce singleton constraint across fleet.",
    );
    this.name = "FleetAuditorConstraintViolationError";
    this.conflictingAuditors = conflictingAuditors;
  }
}

export function isValidAuditorRecord(candidate: unknown): candidate is FleetAuditorRecord {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return false;
  const rec = candidate as Record<string, unknown>;
  const validStatus = ["active", "idle", "stale", "terminated"].includes(String(rec["status"]));
  const hasValidDates =
    typeof rec["started_at"] === "string" && !Number.isNaN(Date.parse(rec["started_at"])) &&
    typeof rec["heartbeat_at"] === "string" && !Number.isNaN(Date.parse(rec["heartbeat_at"]));

  return (
    typeof rec["auditor_id"] === "string" && rec["auditor_id"].trim().length > 0 &&
    typeof rec["role"] === "string" && rec["role"].trim().length > 0 &&
    typeof rec["orchestrator_id"] === "string" && rec["orchestrator_id"].trim().length > 0 &&
    typeof rec["pid"] === "number" && Number.isSafeInteger(rec["pid"]) && rec["pid"] > 0 &&
    validStatus && hasValidDates
  );
}

function extractAuditors(
  input: readonly FleetAuditorRecord[] | readonly FleetOrchestratorState[] | FleetOrchestratorState,
): readonly FleetAuditorRecord[] {
  if (Array.isArray(input)) {
    if (input.length === 0) return [];
    const first = input[0];
    if (typeof first === "object" && first !== null && "auditors" in first) {
      return (input as readonly FleetOrchestratorState[]).flatMap((o) => o.auditors);
    }
    return input as readonly FleetAuditorRecord[];
  }
  if (typeof input === "object" && input !== null && "auditors" in input) return input.auditors;
  return [];
}

export function detectFleetAuditorConflicts(
  input: readonly FleetAuditorRecord[] | readonly FleetOrchestratorState[] | FleetOrchestratorState,
  config: Partial<FleetAuditorConfig> = {},
): readonly FleetAuditorRecord[] {
  const merged = { ...DEFAULT_FLEET_CONFIG, ...config };
  const active = extractAuditors(input).filter((a) => a.status === "active" && merged.allowed_roles.includes(a.role));
  if (active.length <= merged.max_skill_auditors) return [];
  const sorted = [...active].sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
  return sorted.slice(merged.max_skill_auditors);
}

export interface FleetValidationResult {
  readonly valid: boolean;
  readonly activeCount: number;
  readonly violations: readonly string[];
  readonly activeAuditors: readonly FleetAuditorRecord[];
  readonly conflictingAuditors: readonly FleetAuditorRecord[];
}

export function validateSkillAuditorFleetConstraint(
  input: readonly FleetAuditorRecord[] | readonly FleetOrchestratorState[] | FleetOrchestratorState,
  config: Partial<FleetAuditorConfig> = {},
): FleetValidationResult {
  const merged = { ...DEFAULT_FLEET_CONFIG, ...config };
  const all = extractAuditors(input);
  const activeAuditors = all.filter((a) => a.status === "active" && merged.allowed_roles.includes(a.role));
  const conflictingAuditors = detectFleetAuditorConflicts(input, merged);
  const violations: string[] = [];

  if (activeAuditors.length > merged.max_skill_auditors) {
    const ids = activeAuditors.map((a) => `${a.auditor_id}@${a.orchestrator_id}`).join(", ");
    violations.push(
      `SINGLETON_SKILL_AUDITOR_VIOLATION: Expected at most ${merged.max_skill_auditors} active skill auditor across fleet, but found ${activeAuditors.length} active instances across orchestrators: ${ids}`,
    );
  }

  return { valid: violations.length === 0, activeCount: activeAuditors.length, violations, activeAuditors, conflictingAuditors };
}

export function assertSingletonSkillAuditorFleet(
  input: readonly FleetAuditorRecord[] | readonly FleetOrchestratorState[] | FleetOrchestratorState,
  config: Partial<FleetAuditorConfig> = {},
): FleetValidationResult {
  const result = validateSkillAuditorFleetConstraint(input, config);
  if (!result.valid) {
    throw new FleetAuditorConstraintViolationError(result.violations.join("; "), result.conflictingAuditors);
  }
  return result;
}

export function registerFleetAuditor<T extends FleetOrchestratorState | readonly FleetOrchestratorState[]>(
  state: T,
  newAuditor: FleetAuditorRecord,
  config: Partial<FleetAuditorConfig> = {},
): { readonly updatedState: T; readonly registered: FleetAuditorRecord } {
  if (!isValidAuditorRecord(newAuditor)) {
    throw new FleetAuditorConstraintViolationError("INVALID_AUDITOR_RECORD: Candidate record is invalid or incomplete");
  }
  const merged = { ...DEFAULT_FLEET_CONFIG, ...config };
  const existing = extractAuditors(state);

  if (newAuditor.status === "active" && merged.allowed_roles.includes(newAuditor.role)) {
    const activeExisting = existing.filter(
      (a) =>
        a.status === "active" &&
        merged.allowed_roles.includes(a.role) &&
        (a.auditor_id !== newAuditor.auditor_id || a.orchestrator_id !== newAuditor.orchestrator_id),
    );
    if (activeExisting.length >= merged.max_skill_auditors) {
      const primary = activeExisting[0]!;
      throw new FleetAuditorConstraintViolationError(
        `SINGLETON_AUDITOR_COLLISION: Active skill auditor already running (id=${primary.auditor_id}, orchestrator=${primary.orchestrator_id}, pid=${primary.pid}). Spawning redundant skill auditor '${newAuditor.auditor_id}' on orchestrator '${newAuditor.orchestrator_id}' is prohibited.`,
        [newAuditor, ...activeExisting],
      );
    }
  }

  if (Array.isArray(state)) {
    let matched = false;
    const updated = (state as readonly FleetOrchestratorState[]).map((orch) => {
      if (orch.orchestrator_id === newAuditor.orchestrator_id) {
        matched = true;
        return { ...orch, auditors: [...orch.auditors.filter((a) => a.auditor_id !== newAuditor.auditor_id), newAuditor] };
      }
      return orch;
    });
    const result = matched ? updated : [...updated, { orchestrator_id: newAuditor.orchestrator_id, auditors: [newAuditor] }];
    return { updatedState: result as unknown as T, registered: newAuditor };
  }

  const single = state as FleetOrchestratorState;
  const updatedSingle: FleetOrchestratorState = {
    ...single,
    auditors: [...single.auditors.filter((a) => a.auditor_id !== newAuditor.auditor_id), newAuditor],
  };
  return { updatedState: updatedSingle as unknown as T, registered: newAuditor };
}

export function deregisterFleetAuditor<T extends FleetOrchestratorState | readonly FleetOrchestratorState[]>(
  state: T,
  auditorId: string,
  orchestratorId?: string,
): { readonly updatedState: T; readonly deregistered: boolean; readonly record?: FleetAuditorRecord | undefined } {
  let found: FleetAuditorRecord | undefined;
  const updateList = (list: readonly FleetAuditorRecord[]): readonly FleetAuditorRecord[] =>
    list.map((a) => {
      if (a.auditor_id === auditorId && (!orchestratorId || a.orchestrator_id === orchestratorId)) {
        found = { ...a, status: "terminated" };
        return found;
      }
      return a;
    });

  if (Array.isArray(state)) {
    const updated = (state as readonly FleetOrchestratorState[]).map((orch) =>
      !orchestratorId || orch.orchestrator_id === orchestratorId ? { ...orch, auditors: updateList(orch.auditors) } : orch,
    );
    return { updatedState: updated as unknown as T, deregistered: found !== undefined, record: found };
  }

  const single = state as FleetOrchestratorState;
  const updatedSingle: FleetOrchestratorState = { ...single, auditors: updateList(single.auditors) };
  return { updatedState: updatedSingle as unknown as T, deregistered: found !== undefined, record: found };
}

export interface ReconcileFleetAuditorsOptions {
  readonly now?: number | undefined;
  readonly isPidAlive?: ((pid: number) => boolean) | undefined;
  readonly heartbeatTtlMs?: number | undefined;
}

export function reconcileFleetAuditors<T extends FleetOrchestratorState | readonly FleetOrchestratorState[]>(
  state: T,
  options: ReconcileFleetAuditorsOptions = {},
): {
  readonly reconciledState: T;
  readonly activeAuditors: readonly FleetAuditorRecord[];
  readonly staleAuditors: readonly FleetAuditorRecord[];
  readonly terminatedAuditors: readonly FleetAuditorRecord[];
} {
  const now = options.now ?? Date.now();
  const ttl = options.heartbeatTtlMs ?? DEFAULT_FLEET_CONFIG.heartbeat_ttl_ms;
  const isPidAlive = options.isPidAlive ?? (() => true);
  const stale: FleetAuditorRecord[] = [];
  const terminated: FleetAuditorRecord[] = [];
  const active: FleetAuditorRecord[] = [];

  const reconcileList = (auditors: readonly FleetAuditorRecord[]): readonly FleetAuditorRecord[] =>
    auditors.map((auditor) => {
      if (auditor.status === "terminated") {
        terminated.push(auditor);
        return auditor;
      }
      if (!isPidAlive(auditor.pid)) {
        const deadRec: FleetAuditorRecord = { ...auditor, status: "terminated" };
        terminated.push(deadRec);
        return deadRec;
      }
      const hbTime = Date.parse(auditor.heartbeat_at);
      const isStale = Number.isNaN(hbTime) || now - hbTime > ttl;
      const isExpired = auditor.lease_expires_at !== undefined && Date.parse(auditor.lease_expires_at) <= now;
      if (isStale || isExpired) {
        const staleRec: FleetAuditorRecord = { ...auditor, status: "stale" };
        stale.push(staleRec);
        return staleRec;
      }
      if (auditor.status === "active") active.push(auditor);
      return auditor;
    });

  if (Array.isArray(state)) {
    const reconciled = (state as readonly FleetOrchestratorState[]).map((orch) => ({
      ...orch,
      auditors: reconcileList(orch.auditors),
    }));
    return { reconciledState: reconciled as unknown as T, activeAuditors: active, staleAuditors: stale, terminatedAuditors: terminated };
  }

  const single = state as FleetOrchestratorState;
  const reconciledSingle: FleetOrchestratorState = { ...single, auditors: reconcileList(single.auditors) };
  return { reconciledState: reconciledSingle as unknown as T, activeAuditors: active, staleAuditors: stale, terminatedAuditors: terminated };
}
