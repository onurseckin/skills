// @ts-nocheck
import {
  deregisterOrchestrator,
  loadOrchestratorLedger,
  type OrchestratorRegistrationRecord,
} from "./orchestration/index.ts";
import { validateCapsuleManifestBinding } from "./manifest-sync.ts";

export type GhostReason = "UNREGISTERED_IN_LEDGER" | "DESYNCHRONIZED_MANIFEST" | "DETACHED_ORPHAN";

export type GhostActionTaken = "TERMINATED" | "QUARANTINED" | "ALERTED";

export interface GhostOrchestratorFinding {
  readonly process_id: number;
  readonly subagent_id: string;
  readonly conversation_id?: string | undefined;
  readonly detected_at: string;
  readonly reason: GhostReason;
  readonly action_taken: GhostActionTaken;
}

export const DEFAULT_GHOST_STARTUP_GRACE_WINDOW_MS = 5_000;

export interface LiveSubagentInfo {
  readonly subagent_id: string;
  readonly role: string;
  readonly pid: number;
  readonly conversation_id?: string | undefined;
  readonly run_id?: string | undefined;
  readonly status?: string | undefined;
  readonly spawned_at?: string | number | Date | undefined;
  readonly started_at?: string | number | Date | undefined;
}

export interface DetectGhostOptions {
  readonly runRoot?: string | undefined;
  readonly manifestPath?: string | undefined;
  readonly validateManifest?: boolean | undefined;
  readonly isPidAliveFn?: ((pid: number) => boolean) | undefined;
  readonly startupGraceWindowMs?: number | undefined;
  readonly now?: string | number | Date | undefined;
  readonly verifyProcessStartTime?:
    | ((pid: number, expectedStartedAt?: string) => boolean)
    | undefined;
}

export interface TerminateOptions {
  readonly dryRun?: boolean | undefined;
  readonly signal?: NodeJS.Signals | string | undefined;
  readonly killFn?: ((pid: number, signal: NodeJS.Signals | string) => boolean) | undefined;
  readonly customLedgerPath?: string | undefined;
  readonly customLockPath?: string | undefined;
  readonly verifyProcessStartTime?: ((pid: number) => boolean) | undefined;
}

export interface ReconcileRosterOptions {
  readonly liveAgents?: readonly LiveSubagentInfo[] | undefined;
  readonly customLedgerPath?: string | undefined;
  readonly customLockPath?: string | undefined;
  readonly autoTerminate?: boolean | undefined;
  readonly killFn?: ((pid: number, signal: NodeJS.Signals | string) => boolean) | undefined;
  readonly isPidAliveFn?: ((pid: number) => boolean) | undefined;
  readonly runRoot?: string | undefined;
  readonly manifestPath?: string | undefined;
  readonly validateManifest?: boolean | undefined;
  readonly startupGraceWindowMs?: number | undefined;
  readonly now?: string | number | Date | undefined;
  readonly verifyProcessStartTime?:
    | ((pid: number, expectedStartedAt?: string) => boolean)
    | undefined;
}

export interface RosterReconciliationResult {
  readonly active_registered_count: number;
  readonly ghost_count: number;
  readonly findings: readonly GhostOrchestratorFinding[];
  readonly terminated_pids: readonly number[];
}

export function detectGhostOrchestrators(
  liveAgents: readonly LiveSubagentInfo[],
  customLedgerPath?: string,
  options?: DetectGhostOptions,
): readonly GhostOrchestratorFinding[] {
  const records = loadOrchestratorLedger(customLedgerPath);
  const ledgerMap = new Map<string, OrchestratorRegistrationRecord>();
  for (const rec of records) {
    ledgerMap.set(rec.orchestrator_id, rec);
  }

  const findings: GhostOrchestratorFinding[] = [];
  const nowMs = options?.now !== undefined ? new Date(options.now).getTime() : Date.now();
  const now = new Date(nowMs).toISOString();
  const graceMs = options?.startupGraceWindowMs ?? DEFAULT_GHOST_STARTUP_GRACE_WINDOW_MS;

  for (const agent of liveAgents) {
    if (agent.role.trim().toLowerCase() !== "orchestrator") {
      continue;
    }

    // Startup grace window protection
    const spawnInput = agent.spawned_at ?? agent.started_at;
    if (spawnInput !== undefined) {
      const spawnMs = new Date(spawnInput).getTime();
      if (Number.isFinite(spawnMs) && Math.max(0, nowMs - spawnMs) < graceMs) {
        continue;
      }
    }

    if (options?.isPidAliveFn && !options.isPidAliveFn(agent.pid)) {
      continue;
    }

    const record = ledgerMap.get(agent.subagent_id);

    // PID recycling verification hook
    if (
      options?.verifyProcessStartTime &&
      !options.verifyProcessStartTime(agent.pid, record?.spawned_at)
    ) {
      continue;
    }

    if (!record) {
      findings.push({
        process_id: agent.pid,
        subagent_id: agent.subagent_id,
        conversation_id: agent.conversation_id,
        detected_at: now,
        reason: "UNREGISTERED_IN_LEDGER",
        action_taken: "ALERTED",
      });
      continue;
    }

    const isActiveStatus = record.status === "ACTIVE" || record.status === "INITIALIZING";
    if (!isActiveStatus) {
      findings.push({
        process_id: agent.pid,
        subagent_id: agent.subagent_id,
        conversation_id: agent.conversation_id ?? record.conversation_id,
        detected_at: now,
        reason: "DETACHED_ORPHAN",
        action_taken: "ALERTED",
      });
      continue;
    }

    if (agent.status === "orphaned" || agent.status === "detached") {
      findings.push({
        process_id: agent.pid,
        subagent_id: agent.subagent_id,
        conversation_id: agent.conversation_id ?? record.conversation_id,
        detected_at: now,
        reason: "DETACHED_ORPHAN",
        action_taken: "ALERTED",
      });
      continue;
    }

    if (record.pid !== agent.pid) {
      findings.push({
        process_id: agent.pid,
        subagent_id: agent.subagent_id,
        conversation_id: agent.conversation_id ?? record.conversation_id,
        detected_at: now,
        reason: "UNREGISTERED_IN_LEDGER",
        action_taken: "ALERTED",
      });
      continue;
    }

    if (agent.run_id && agent.run_id !== record.run_id) {
      findings.push({
        process_id: agent.pid,
        subagent_id: agent.subagent_id,
        conversation_id: agent.conversation_id ?? record.conversation_id,
        detected_at: now,
        reason: "DESYNCHRONIZED_MANIFEST",
        action_taken: "ALERTED",
      });
      continue;
    }

    if (options?.validateManifest !== false) {
      const valResult = validateCapsuleManifestBinding(record, {
        runRoot: options?.runRoot,
        manifestPath: options?.manifestPath,
      });
      if (!valResult.valid) {
        findings.push({
          process_id: agent.pid,
          subagent_id: agent.subagent_id,
          conversation_id: agent.conversation_id ?? record.conversation_id,
          detected_at: now,
          reason: "DESYNCHRONIZED_MANIFEST",
          action_taken: "ALERTED",
        });
        continue;
      }
    }
  }

  return findings;
}

export function terminateDetachedOrchestrator(
  finding: GhostOrchestratorFinding,
  options?: TerminateOptions,
): boolean {
  if (options?.dryRun) return false;
  if (options?.verifyProcessStartTime && !options.verifyProcessStartTime(finding.process_id)) {
    return false;
  }

  const signal = options?.signal ?? "SIGTERM";
  let terminated = false;

  if (options?.killFn) {
    try {
      terminated = options.killFn(finding.process_id, signal);
    } catch {
      terminated = false;
    }
  } else {
    try {
      process.kill(finding.process_id, signal);
      terminated = true;
    } catch {
      terminated = false;
    }
  }

  if (terminated) {
    try {
      deregisterOrchestrator(
        finding.subagent_id,
        "GHOST_TERMINATED",
        options?.customLedgerPath,
        options?.customLockPath,
      );
    } catch {
      // Non-fatal if ledger entry not found or lock error
    }
  }

  return terminated;
}

export function reconcileOrchestratorRoster(
  options?: ReconcileRosterOptions,
): RosterReconciliationResult {
  const liveAgents = options?.liveAgents ?? [];
  const rawFindings = detectGhostOrchestrators(liveAgents, options?.customLedgerPath, {
    runRoot: options?.runRoot,
    manifestPath: options?.manifestPath,
    validateManifest: options?.validateManifest,
    isPidAliveFn: options?.isPidAliveFn,
    startupGraceWindowMs: options?.startupGraceWindowMs,
    now: options?.now,
    verifyProcessStartTime: options?.verifyProcessStartTime,
  });

  const ghostPids = new Set(rawFindings.map((f) => f.process_id));
  const isPidAlive = options?.isPidAliveFn;
  const liveOrchestratorCount = liveAgents.filter(
    (a) =>
      a.role.trim().toLowerCase() === "orchestrator" &&
      (!isPidAlive || isPidAlive(a.pid)) &&
      !ghostPids.has(a.pid),
  ).length;

  const finalFindings: GhostOrchestratorFinding[] = [];
  const terminatedPids: number[] = [];

  for (const finding of rawFindings) {
    if (options?.autoTerminate) {
      const killed = terminateDetachedOrchestrator(finding, {
        killFn: options.killFn,
        customLedgerPath: options.customLedgerPath,
        customLockPath: options.customLockPath,
        verifyProcessStartTime: options.verifyProcessStartTime,
      });
      if (killed) {
        finalFindings.push({ ...finding, action_taken: "TERMINATED" });
        terminatedPids.push(finding.process_id);
      } else {
        finalFindings.push(finding);
      }
    } else {
      finalFindings.push(finding);
    }
  }

  return {
    active_registered_count: liveOrchestratorCount,
    ghost_count: rawFindings.length,
    findings: finalFindings,
    terminated_pids: terminatedPids,
  };
}
