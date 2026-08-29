import {
  deregisterOrchestrator,
  loadOrchestratorLedger,
  type OrchestratorRegistrationRecord,
} from "../lifecycle/orchestrator-ledger.ts";
import {
  detectGhostOrchestrators,
  type GhostOrchestratorFinding,
  type LiveSubagentInfo,
} from "../lifecycle/ghost-reconciler.ts";

export { type GhostOrchestratorFinding, type LiveSubagentInfo };

export const DEFAULT_HEARTBEAT_THRESHOLD_SECONDS = 300;
export const DEFAULT_SINGLETON_ROLE = "skill_auditor";

export interface RosterReconciliationReport {
  readonly total_active_orchestrators: number;
  readonly ghost_processes_found: readonly GhostOrchestratorFinding[];
  readonly zombies_reclaimed: readonly string[];
  readonly singleton_auditor_compliant: boolean;
  readonly timestamp: string;
}

export interface AuditLivenessOptions {
  readonly customLedgerPath?: string | undefined;
  readonly customLockPath?: string | undefined;
  readonly liveAgents?: readonly LiveSubagentInfo[] | undefined;
  readonly heartbeatThresholdSeconds?: number | undefined;
  readonly now?: Date | string | undefined;
  readonly isPidAliveFn?: ((pid: number) => boolean) | undefined;
  readonly killFn?: ((pid: number, signal: NodeJS.Signals | string) => boolean) | undefined;
}

export interface ReclaimZombieOptions {
  readonly customLedgerPath?: string | undefined;
  readonly customLockPath?: string | undefined;
  readonly reason?: string | undefined;
}

export function defaultIsPidAlive(pid: number): boolean {
  if (pid <= 0 || !Number.isInteger(pid)) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && "code" in err) {
      return (err as { code?: string }).code === "EPERM";
    }
    return false;
  }
}

function parseTimestampMs(now?: Date | string): number {
  if (!now) return Date.now();
  if (now instanceof Date) return now.getTime();
  const parsed = Date.parse(now);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function toIsoTimestamp(now?: Date | string): string {
  if (!now) return new Date().toISOString();
  if (now instanceof Date) return now.toISOString();
  const parsed = Date.parse(now);
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
}

export function reclaimZombieOrchestrator(
  orchestratorId: string,
  options?: ReclaimZombieOptions,
): boolean {
  if (!orchestratorId || typeof orchestratorId !== "string" || !orchestratorId.trim()) {
    return false;
  }
  const result = deregisterOrchestrator(
    orchestratorId.trim(),
    "ZOMBIE_RECLAIMED",
    options?.customLedgerPath,
    options?.customLockPath,
  );
  return result !== null;
}

export function auditOrchestratorLiveness(
  options?: AuditLivenessOptions,
): RosterReconciliationReport {
  const customLedgerPath = options?.customLedgerPath;
  const customLockPath = options?.customLockPath;
  const liveAgents = options?.liveAgents ?? [];
  const heartbeatThresholdSeconds =
    options?.heartbeatThresholdSeconds ?? DEFAULT_HEARTBEAT_THRESHOLD_SECONDS;
  const isPidAlive = options?.isPidAliveFn ?? defaultIsPidAlive;
  const nowMs = parseTimestampMs(options?.now);
  const isoTimestamp = toIsoTimestamp(options?.now);

  const records: OrchestratorRegistrationRecord[] = loadOrchestratorLedger(customLedgerPath);
  const activeRecords = records.filter((r) => r.status === "ACTIVE");

  const zombiesReclaimed: string[] = [];

  for (const record of activeRecords) {
    const pidAlive = isPidAlive(record.pid);
    const lastHeartbeatMs = Date.parse(record.last_heartbeat_at);
    const heartbeatAgeSeconds = Number.isNaN(lastHeartbeatMs)
      ? Number.POSITIVE_INFINITY
      : Math.max(0, (nowMs - lastHeartbeatMs) / 1000);

    const isZombie = !pidAlive || heartbeatAgeSeconds > heartbeatThresholdSeconds;

    if (isZombie) {
      if (pidAlive && options?.killFn) {
        try {
          options.killFn(record.pid, "SIGTERM");
        } catch {}
      }
      const deregistered = deregisterOrchestrator(
        record.orchestrator_id,
        "ZOMBIE_RECLAIMED",
        customLedgerPath,
        customLockPath,
      );
      if (deregistered) {
        zombiesReclaimed.push(record.orchestrator_id);
      }
    }
  }

  const remainingActiveCount = activeRecords.length - zombiesReclaimed.length;

  const ghostFindings = detectGhostOrchestrators(liveAgents, customLedgerPath, {
    isPidAliveFn: isPidAlive,
  });

  const activeAuditors = liveAgents.filter((agent) => {
    const isAuditor = agent.role.trim().toLowerCase() === DEFAULT_SINGLETON_ROLE;
    const isActive = agent.status === undefined || agent.status.trim().toUpperCase() === "ACTIVE";
    return isAuditor && isActive;
  });

  const singletonAuditorCompliant = activeAuditors.length <= 1;

  return {
    total_active_orchestrators: remainingActiveCount,
    ghost_processes_found: ghostFindings,
    zombies_reclaimed: Object.freeze(zombiesReclaimed),
    singleton_auditor_compliant: singletonAuditorCompliant,
    timestamp: isoTimestamp,
  };
}
