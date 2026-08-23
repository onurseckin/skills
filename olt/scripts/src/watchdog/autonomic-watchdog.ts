import { existsSync } from "node:fs";
import { loadRun } from "../engine/store/index.ts";
import { isJsonObject, type JsonObject } from "../core/contracts/json.ts";
import {
  auditTierConfinement,
  type TierConfinementFinding,
} from "../reporting/doctor/tier-confinement.ts";
import { BootGateEnforcer } from "./boot-gate-enforcer.ts";
import {
  DEFAULT_ADAPTIVE_ACTIVITY_BOOST,
  DEFAULT_ADAPTIVE_BACKOFF_FACTOR,
  DEFAULT_ADAPTIVE_MAX_INTERVAL_MS,
  DEFAULT_ADAPTIVE_MIN_INTERVAL_MS,
  DEFAULT_HEALTH_AUDIT_INTERVAL_MS,
  DEFAULT_PROCESS_HEALTH_CHECK_INTERVAL_MS,
  DEFAULT_WATCHDOG_HEARTBEAT_INTERVAL_MS,
  DEFAULT_WATCHDOG_TIMEOUT_MS,
} from "./constants.ts";
import type {
  AdaptiveAdjustmentReason,
  AdaptiveTimerConfig,
  AdaptiveTimerState,
  AutonomicWatchdogConfig,
  LiveCliProof,
  ProcessHealthStatus,
  ReactiveEvent,
  ReactiveWakeupTrigger,
  SubagentBootGateRecord,
  SubagentRegistrationOptions,
  WatchdogEvent,
  WatchdogEventListener,
  WatchdogFinding,
  WatchdogHealthAuditReport,
  WatchdogTickReport,
} from "./types.ts";

export interface AgentActivityState {
  readonly agentId: string;
  readonly taskId: string | null;
  readonly pid?: number | undefined;
  readonly lastHeartbeatAt: number;
  readonly lastActivityAt: number;
  readonly status: "active" | "stalled";
  readonly lastProcessHealth?: ProcessHealthStatus | undefined;
}

function defaultProcessLivenessChecker(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class AutonomicWatchdog {
  public readonly heartbeatIntervalMs: number;
  public readonly timeoutMs: number;
  public readonly healthAuditIntervalMs: number;
  public readonly processHealthCheckIntervalMs: number;
  public readonly capsuleRoot: string | null;
  public readonly generation: number;
  public readonly pulseId: string | null;
  public readonly enforcePreFlightGates: boolean;

  private readonly bootGateEnforcer: BootGateEnforcer;
  private readonly processLivenessChecker: (pid: number) => boolean;
  private readonly activities = new Map<string, AgentActivityState>();
  private readonly listeners = new Map<string, Set<WatchdogEventListener>>();
  private readonly onHeartbeatCallback:
    | ((tick: WatchdogTickReport) => void | Promise<void>)
    | undefined;
  private readonly onHealthAuditCallback:
    | ((audit: WatchdogHealthAuditReport) => void | Promise<void>)
    | undefined;
  private readonly onViolationCallback:
    | ((finding: WatchdogFinding) => void | Promise<void>)
    | undefined;
  private readonly onReactiveWakeupCallback:
    | ((trigger: ReactiveEvent, tick: WatchdogTickReport) => void | Promise<void>)
    | undefined;
  private readonly onIntervalAdjustedCallback:
    | ((state: AdaptiveTimerState) => void | Promise<void>)
    | undefined;

  private adaptiveEnabled: boolean;
  private minIntervalMsState: number;
  private maxIntervalMsState: number;
  private backoffFactorState: number;
  private activityBoostState: number;
  private currentIntervalMsState: number;
  private lastAdjustmentReasonState: AdaptiveAdjustmentReason = "initial";
  private lastAdjustedAtState: string;
  private activeEventCountSinceLastTick = 0;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private isRunningState = false;
  private tickCount = 0;
  private startedAtMs: number;
  private readonly hasExplicitInitialStartedAt: boolean;

  public constructor(config: AutonomicWatchdogConfig = {}) {
    this.heartbeatIntervalMs = config.heartbeatIntervalMs ?? DEFAULT_WATCHDOG_HEARTBEAT_INTERVAL_MS;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_WATCHDOG_TIMEOUT_MS;
    this.healthAuditIntervalMs = config.healthAuditIntervalMs ?? DEFAULT_HEALTH_AUDIT_INTERVAL_MS;
    this.processHealthCheckIntervalMs =
      config.processHealthCheckIntervalMs ?? DEFAULT_PROCESS_HEALTH_CHECK_INTERVAL_MS;
    this.capsuleRoot = config.capsuleRoot ?? null;
    this.generation = config.generation ?? 1;
    this.pulseId = config.pulseId ?? null;
    this.enforcePreFlightGates = config.enforcePreFlightGates !== false;
    this.processLivenessChecker = config.processLivenessChecker ?? defaultProcessLivenessChecker;

    this.bootGateEnforcer = new BootGateEnforcer();
    this.onHeartbeatCallback = config.onHeartbeat;
    this.onHealthAuditCallback = config.onHealthAudit;
    this.onViolationCallback = config.onViolation;
    this.onReactiveWakeupCallback = config.onReactiveWakeup;
    this.onIntervalAdjustedCallback = config.onIntervalAdjusted;

    this.hasExplicitInitialStartedAt = config.initialStartedAt !== undefined;
    const parsedInitial =
      typeof config.initialStartedAt === "number"
        ? config.initialStartedAt
        : config.initialStartedAt instanceof Date
          ? config.initialStartedAt.getTime()
          : typeof config.initialStartedAt === "string"
            ? Date.parse(config.initialStartedAt)
            : NaN;
    this.startedAtMs = Number.isFinite(parsedInitial) ? parsedInitial : Date.now();
    this.lastAdjustedAtState = new Date(this.startedAtMs).toISOString();

    const adaptiveConfig =
      typeof config.adaptive === "object" && config.adaptive !== null ? config.adaptive : undefined;

    this.adaptiveEnabled =
      config.adaptive !== false &&
      (config.adaptive !== undefined ||
        config.minIntervalMs !== undefined ||
        config.maxIntervalMs !== undefined ||
        config.backoffFactor !== undefined ||
        config.activityBoost !== undefined ||
        true);

    const minBound =
      adaptiveConfig?.minIntervalMs ?? config.minIntervalMs ?? DEFAULT_ADAPTIVE_MIN_INTERVAL_MS;
    const maxBound =
      adaptiveConfig?.maxIntervalMs ??
      config.maxIntervalMs ??
      Math.max(DEFAULT_ADAPTIVE_MAX_INTERVAL_MS, this.heartbeatIntervalMs);

    this.minIntervalMsState = Math.min(minBound, maxBound);
    this.maxIntervalMsState = Math.max(minBound, maxBound);
    this.backoffFactorState =
      adaptiveConfig?.backoffFactor ?? config.backoffFactor ?? DEFAULT_ADAPTIVE_BACKOFF_FACTOR;
    this.activityBoostState =
      adaptiveConfig?.activityBoost ?? config.activityBoost ?? DEFAULT_ADAPTIVE_ACTIVITY_BOOST;

    const initial =
      adaptiveConfig?.initialIntervalMs ??
      config.heartbeatIntervalMs ??
      DEFAULT_WATCHDOG_HEARTBEAT_INTERVAL_MS;

    this.currentIntervalMsState = Math.min(
      Math.max(initial, this.minIntervalMsState),
      this.maxIntervalMsState,
    );
  }

  public getBootGateEnforcer(): BootGateEnforcer {
    return this.bootGateEnforcer;
  }

  public registerSubagent(
    options: SubagentRegistrationOptions,
    now?: string | number | Date,
  ): SubagentBootGateRecord {
    const timestamp = now !== undefined ? new Date(now).toISOString() : new Date().toISOString();
    const timeMs =
      typeof now === "number"
        ? now
        : now instanceof Date
          ? now.getTime()
          : typeof now === "string"
            ? Date.parse(now)
            : Date.now();

    const record = this.bootGateEnforcer.registerSpawnedSubagent(options, timestamp);

    if (!this.activities.has(options.agentId)) {
      this.activities.set(options.agentId, {
        agentId: options.agentId,
        taskId: options.taskId ?? null,
        ...(options.pid !== undefined ? { pid: options.pid } : {}),
        lastHeartbeatAt: Number.isFinite(timeMs) ? timeMs : Date.now(),
        lastActivityAt: Number.isFinite(timeMs) ? timeMs : Date.now(),
        status: "active",
      });
    }

    return record;
  }

  public recordWhoami(
    agentId: string,
    now?: string | number | Date,
    proof?: Partial<LiveCliProof>,
  ): SubagentBootGateRecord {
    const timestamp = now !== undefined ? new Date(now).toISOString() : new Date().toISOString();
    this.recordActivity(agentId, undefined, now);
    return this.bootGateEnforcer.recordWhoamiExecution(agentId, timestamp, proof);
  }

  public recordDoctor(
    agentId: string,
    now?: string | number | Date,
    proof?: Partial<LiveCliProof>,
  ): SubagentBootGateRecord {
    const timestamp = now !== undefined ? new Date(now).toISOString() : new Date().toISOString();
    this.recordActivity(agentId, undefined, now);
    return this.bootGateEnforcer.recordDoctorExecution(agentId, timestamp, proof);
  }

  public recordCliProof(
    proof: LiveCliProof,
    now?: string | number | Date,
  ): SubagentBootGateRecord | undefined {
    const timestamp = now !== undefined ? new Date(now).toISOString() : new Date().toISOString();
    this.recordActivity(proof.actor, undefined, now);
    return this.bootGateEnforcer.recordCliProof(proof, timestamp);
  }

  public recordCommand(
    agentId: string,
    argv: readonly string[],
    now?: string | number | Date,
    exitCode?: number,
    pid?: number,
    outputSnippet?: string,
  ): void {
    const timestamp = now !== undefined ? new Date(now).toISOString() : new Date().toISOString();
    this.recordActivity(agentId, undefined, now);
    this.bootGateEnforcer.recordCommandExecution(
      agentId,
      argv,
      timestamp,
      exitCode,
      pid,
      outputSnippet,
    );
  }

  public recordHeartbeat(agentId: string, taskId?: string, now?: string | number | Date): void {
    const timeMs =
      typeof now === "number"
        ? now
        : now instanceof Date
          ? now.getTime()
          : typeof now === "string"
            ? Date.parse(now)
            : Date.now();
    const resolvedMs = Number.isFinite(timeMs) ? timeMs : Date.now();

    const existing = this.activities.get(agentId);
    this.activities.set(agentId, {
      agentId,
      taskId: taskId ?? existing?.taskId ?? null,
      ...(existing?.pid !== undefined ? { pid: existing.pid } : {}),
      lastHeartbeatAt: resolvedMs,
      lastActivityAt: resolvedMs,
      status: "active",
      ...(existing?.lastProcessHealth !== undefined
        ? { lastProcessHealth: existing.lastProcessHealth }
        : {}),
    });
  }

  public recordActivity(agentId: string, taskId?: string, now?: string | number | Date): void {
    const timeMs =
      typeof now === "number"
        ? now
        : now instanceof Date
          ? now.getTime()
          : typeof now === "string"
            ? Date.parse(now)
            : Date.now();
    const resolvedMs = Number.isFinite(timeMs) ? timeMs : Date.now();

    const existing = this.activities.get(agentId);
    this.activities.set(agentId, {
      agentId,
      taskId: taskId ?? existing?.taskId ?? null,
      ...(existing?.pid !== undefined ? { pid: existing.pid } : {}),
      lastHeartbeatAt: existing?.lastHeartbeatAt ?? resolvedMs,
      lastActivityAt: resolvedMs,
      status: "active",
      ...(existing?.lastProcessHealth !== undefined
        ? { lastProcessHealth: existing.lastProcessHealth }
        : {}),
    });
  }

  public checkProcessHealth(
    pid: number,
    agentId?: string,
    now?: string | number | Date,
  ): ProcessHealthStatus {
    const timestamp = now !== undefined ? new Date(now).toISOString() : new Date().toISOString();
    const alive = this.processLivenessChecker(pid);

    const status: ProcessHealthStatus = {
      pid,
      alive,
      ...(agentId !== undefined ? { agentId } : {}),
      checkedAt: timestamp,
      ...(alive ? {} : { error: `Process ${pid} is not running or has terminated` }),
    };

    if (agentId) {
      this.bootGateEnforcer.updateProcessHealth(agentId, status);
      const existing = this.activities.get(agentId);
      if (existing) {
        this.activities.set(agentId, {
          ...existing,
          pid,
          lastProcessHealth: status,
        });
      }
    }

    return status;
  }

  public auditProcessHealth(now?: string | number | Date): readonly ProcessHealthStatus[] {
    const results: ProcessHealthStatus[] = [];
    const allRecords = this.bootGateEnforcer.getAllRecords();

    for (const rec of allRecords) {
      if (rec.pid !== undefined) {
        const health = this.checkProcessHealth(rec.pid, rec.agentId, now);
        results.push(health);
      }
    }

    for (const act of this.activities.values()) {
      if (act.pid !== undefined && !allRecords.some((r) => r.agentId === act.agentId)) {
        const health = this.checkProcessHealth(act.pid, act.agentId, now);
        results.push(health);
      }
    }

    return results;
  }

  public assertBootGatesPassed(
    agentId: string,
    operationDescription = "performing task operations",
    requireValidProof = false,
  ): void {
    this.bootGateEnforcer.assertBootGatesPassed(agentId, operationDescription, requireValidProof);
  }

  public async runHealthAudit(
    currentTime?: string | number | Date,
  ): Promise<WatchdogHealthAuditReport> {
    const timeMs =
      typeof currentTime === "number"
        ? currentTime
        : currentTime instanceof Date
          ? currentTime.getTime()
          : typeof currentTime === "string"
            ? Date.parse(currentTime)
            : Date.now();
    const resolvedMs = Number.isFinite(timeMs) ? timeMs : Date.now();
    const timestamp = new Date(resolvedMs).toISOString();

    const findings: WatchdogFinding[] = [];

    // 1. Audit Subagents in state if capsuleRoot is present
    let rawState: JsonObject | null = null;
    if (this.capsuleRoot && existsSync(this.capsuleRoot)) {
      try {
        const loaded = loadRun(this.capsuleRoot, false);
        rawState = isJsonObject(loaded.state) ? (loaded.state as JsonObject) : null;
      } catch {
        // Fallback in memory
      }
    }

    if (rawState) {
      this.bootGateEnforcer.auditSubagentBootGatesFromState(rawState, timestamp);
    }

    // 2. Audit Boot Gate compliance
    const allRecords = this.bootGateEnforcer.getAllRecords();
    const bootGateFindings = this.bootGateEnforcer.auditFindings(allRecords, timestamp);
    findings.push(...bootGateFindings);

    const bootGateCompliantCount = allRecords.filter((r) => r.bootGatePassed).length;
    const bootGateViolationsCount = allRecords.length - bootGateCompliantCount;

    // 3. Audit Stalled / Inactive Agents
    let stalledAgentsCount = 0;
    let activeLeasesCount = 0;

    for (const act of this.activities.values()) {
      const elapsedHeartbeat = resolvedMs - act.lastHeartbeatAt;
      const elapsedActivity = resolvedMs - act.lastActivityAt;

      if (elapsedHeartbeat > this.timeoutMs || elapsedActivity > this.timeoutMs) {
        stalledAgentsCount++;
        const finding: WatchdogFinding = {
          id: `finding-stalled-${act.agentId}`,
          agentId: act.agentId,
          taskId: act.taskId ?? undefined,
          violationType: "stalled_agent",
          severity: "critical",
          observation: `Agent "${act.agentId}" has exceeded watchdog heartbeat timeout: ${elapsedHeartbeat}ms without heartbeat (timeout: ${this.timeoutMs}ms)`,
          remediation:
            "Agent appears stalled or unresponsive. Issue an immediate auto-wake pulse or release task lease.",
          timestamp,
          evidence: {
            agentId: act.agentId,
            taskId: act.taskId,
            lastHeartbeatAt: new Date(act.lastHeartbeatAt).toISOString(),
            lastActivityAt: new Date(act.lastActivityAt).toISOString(),
            elapsedHeartbeatMs: elapsedHeartbeat,
            timeoutMs: this.timeoutMs,
          },
        };
        findings.push(finding);
        this.emit({
          type: "stall_detected",
          agentId: act.agentId,
          finding,
        });
      } else {
        activeLeasesCount++;
      }
    }

    // 4. Audit Live Process Health
    let deadProcessesCount = 0;
    for (const rec of allRecords) {
      if (rec.pid !== undefined) {
        const isAlive = this.processLivenessChecker(rec.pid);
        const healthStatus: ProcessHealthStatus = {
          pid: rec.pid,
          alive: isAlive,
          agentId: rec.agentId,
          checkedAt: timestamp,
          ...(isAlive ? {} : { error: `Process PID ${rec.pid} has exited or is unreachable` }),
        };
        this.bootGateEnforcer.updateProcessHealth(rec.agentId, healthStatus);

        if (!isAlive) {
          deadProcessesCount++;
          const finding: WatchdogFinding = {
            id: `finding-proc-health-${rec.agentId}-${rec.pid}`,
            agentId: rec.agentId,
            role: rec.role,
            taskId: rec.taskId ?? undefined,
            violationType: "process_health_failure",
            severity: "critical",
            observation: `Subagent process "${rec.agentId}" (PID ${rec.pid}) has terminated unexpectedly or is dead while task lease / monitoring is active.`,
            remediation:
              "Clean up zombie task lease, reclaim task or dispatch fresh subagent worker.",
            timestamp,
            evidence: {
              agentId: rec.agentId,
              role: rec.role,
              pid: rec.pid,
              alive: false,
              checkedAt: timestamp,
            },
          };
          findings.push(finding);
          this.emit({
            type: "process_failure_detected",
            agentId: rec.agentId,
            pid: rec.pid,
            finding,
          });
        }
      }
    }

    // 5. Audit Tier Confinement if capsuleRoot is available
    let tierViolationsCount = 0;
    if (this.capsuleRoot && existsSync(this.capsuleRoot)) {
      try {
        const tierFindings: TierConfinementFinding[] = auditTierConfinement(
          this.capsuleRoot,
          rawState,
        );
        tierViolationsCount = tierFindings.length;
        for (const tf of tierFindings) {
          findings.push({
            id: `finding-tier-${tf.agent_id}-${tf.violation_type}`,
            agentId: tf.agent_id,
            role: tf.role,
            violationType:
              tf.violation_type === "supervisor_code_contamination"
                ? "supervisor_code_contamination"
                : "tier_confinement_breach",
            severity: tf.severity === "critical" ? "critical" : "important",
            observation: tf.observation,
            remediation: tf.remediation,
            timestamp,
            ...(tf.evidence ? { evidence: tf.evidence } : {}),
          });
        }
      } catch {
        // Continue with local audit
      }
    }

    const healthy =
      bootGateViolationsCount === 0 &&
      stalledAgentsCount === 0 &&
      deadProcessesCount === 0 &&
      tierViolationsCount === 0;

    const summary = healthy
      ? `Autonomic watchdog healthy: ${allRecords.length} subagents compliant, ${activeLeasesCount} active monitors.`
      : `Autonomic watchdog detected issues: ${bootGateViolationsCount} boot-gate violations, ${stalledAgentsCount} stalled agents, ${deadProcessesCount} dead processes, ${tierViolationsCount} tier violations.`;

    const report: WatchdogHealthAuditReport = {
      healthy,
      timestamp,
      activeLeasesCount,
      stalledAgentsCount,
      deadProcessesCount,
      subagentCount: allRecords.length,
      bootGateCompliantCount,
      bootGateViolationsCount,
      tierViolationsCount,
      findings,
      summary,
    };

    this.emit({ type: "health_audit", report });

    if (this.onHealthAuditCallback) {
      await this.onHealthAuditCallback(report);
    }

    for (const finding of findings) {
      if (finding.severity === "critical") {
        this.emit({ type: "critical_violation", finding });
      }
      if (this.onViolationCallback) {
        await this.onViolationCallback(finding);
      }
    }

    return report;
  }

  public get currentIntervalMs(): number {
    return this.currentIntervalMsState;
  }

  public get minIntervalMs(): number {
    return this.minIntervalMsState;
  }

  public get maxIntervalMs(): number {
    return this.maxIntervalMsState;
  }

  public get backoffFactor(): number {
    return this.backoffFactorState;
  }

  public get activityBoost(): number {
    return this.activityBoostState;
  }

  public isAdaptive(): boolean {
    return this.adaptiveEnabled;
  }

  public getCurrentIntervalMs(): number {
    return this.currentIntervalMsState;
  }

  public getAdaptiveState(): AdaptiveTimerState {
    return {
      enabled: this.adaptiveEnabled,
      currentIntervalMs: this.currentIntervalMsState,
      minIntervalMs: this.minIntervalMsState,
      maxIntervalMs: this.maxIntervalMsState,
      backoffFactor: this.backoffFactorState,
      activityBoost: this.activityBoostState,
      lastAdjustmentReason: this.lastAdjustmentReasonState,
      lastAdjustedAt: this.lastAdjustedAtState,
    };
  }

  public configureAdaptiveTimers(config: Partial<AdaptiveTimerConfig>): void {
    if (config.enabled !== undefined) {
      this.adaptiveEnabled = config.enabled;
    }
    if (
      config.minIntervalMs !== undefined &&
      Number.isFinite(config.minIntervalMs) &&
      config.minIntervalMs > 0
    ) {
      this.minIntervalMsState = config.minIntervalMs;
    }
    if (
      config.maxIntervalMs !== undefined &&
      Number.isFinite(config.maxIntervalMs) &&
      config.maxIntervalMs > 0
    ) {
      this.maxIntervalMsState = config.maxIntervalMs;
    }
    if (this.minIntervalMsState > this.maxIntervalMsState) {
      const temp = this.minIntervalMsState;
      this.minIntervalMsState = this.maxIntervalMsState;
      this.maxIntervalMsState = temp;
    }
    if (
      config.backoffFactor !== undefined &&
      Number.isFinite(config.backoffFactor) &&
      config.backoffFactor > 1
    ) {
      this.backoffFactorState = config.backoffFactor;
    }
    if (
      config.activityBoost !== undefined &&
      Number.isFinite(config.activityBoost) &&
      config.activityBoost > 0
    ) {
      this.activityBoostState = config.activityBoost;
    }
    if (config.initialIntervalMs !== undefined && Number.isFinite(config.initialIntervalMs)) {
      this.currentIntervalMsState = Math.min(
        Math.max(config.initialIntervalMs, this.minIntervalMsState),
        this.maxIntervalMsState,
      );
    } else {
      this.currentIntervalMsState = Math.min(
        Math.max(this.currentIntervalMsState, this.minIntervalMsState),
        this.maxIntervalMsState,
      );
    }
  }

  public setAdaptiveBounds(bounds: Partial<AdaptiveTimerConfig>): void {
    this.configureAdaptiveTimers(bounds);
  }

  public boostActivity(
    multiplier?: number,
    now?: string | number | Date,
    reason: AdaptiveAdjustmentReason = "activity_burst",
  ): number {
    if (!this.adaptiveEnabled) {
      return this.currentIntervalMsState;
    }

    const factor =
      multiplier !== undefined && Number.isFinite(multiplier) && multiplier > 0
        ? multiplier
        : this.activityBoostState;

    const previousIntervalMs = this.currentIntervalMsState;
    const newIntervalMs = Math.max(
      this.minIntervalMsState,
      Math.round(this.currentIntervalMsState * factor),
    );

    if (newIntervalMs !== previousIntervalMs) {
      this.currentIntervalMsState = newIntervalMs;
      this.lastAdjustmentReasonState = reason;
      const timeMs =
        typeof now === "number"
          ? now
          : now instanceof Date
            ? now.getTime()
            : typeof now === "string"
              ? Date.parse(now)
              : Date.now();
      const resolvedMs = Number.isFinite(timeMs) ? timeMs : Date.now();
      this.lastAdjustedAtState = new Date(resolvedMs).toISOString();

      const state = this.getAdaptiveState();
      this.emit({
        type: "interval_adjusted",
        previousIntervalMs,
        newIntervalMs,
        reason,
        state,
      });

      if (this.onIntervalAdjustedCallback) {
        void this.onIntervalAdjustedCallback(state);
      }

      if (this.isRunningState) {
        this.scheduleNextTick();
      }
    }

    return this.currentIntervalMsState;
  }

  public decayIdle(
    multiplier?: number,
    now?: string | number | Date,
    reason: AdaptiveAdjustmentReason = "idle_backoff",
  ): number {
    if (!this.adaptiveEnabled) {
      return this.currentIntervalMsState;
    }

    const factor =
      multiplier !== undefined && Number.isFinite(multiplier) && multiplier > 1
        ? multiplier
        : this.backoffFactorState;

    const previousIntervalMs = this.currentIntervalMsState;
    const newIntervalMs = Math.min(
      this.maxIntervalMsState,
      Math.round(this.currentIntervalMsState * factor),
    );

    if (newIntervalMs !== previousIntervalMs) {
      this.currentIntervalMsState = newIntervalMs;
      this.lastAdjustmentReasonState = reason;
      const timeMs =
        typeof now === "number"
          ? now
          : now instanceof Date
            ? now.getTime()
            : typeof now === "string"
              ? Date.parse(now)
              : Date.now();
      const resolvedMs = Number.isFinite(timeMs) ? timeMs : Date.now();
      this.lastAdjustedAtState = new Date(resolvedMs).toISOString();

      const state = this.getAdaptiveState();
      this.emit({
        type: "interval_adjusted",
        previousIntervalMs,
        newIntervalMs,
        reason,
        state,
      });

      if (this.onIntervalAdjustedCallback) {
        void this.onIntervalAdjustedCallback(state);
      }

      if (this.isRunningState) {
        this.scheduleNextTick();
      }
    }

    return this.currentIntervalMsState;
  }

  public resetInterval(intervalMs?: number, now?: string | number | Date): void {
    const target = intervalMs ?? this.heartbeatIntervalMs;
    const previousIntervalMs = this.currentIntervalMsState;
    const newIntervalMs = Math.min(
      Math.max(target, this.minIntervalMsState),
      this.maxIntervalMsState,
    );

    if (newIntervalMs !== previousIntervalMs) {
      this.currentIntervalMsState = newIntervalMs;
      this.lastAdjustmentReasonState = "manual_reset";
      const timeMs =
        typeof now === "number"
          ? now
          : now instanceof Date
            ? now.getTime()
            : typeof now === "string"
              ? Date.parse(now)
              : Date.now();
      const resolvedMs = Number.isFinite(timeMs) ? timeMs : Date.now();
      this.lastAdjustedAtState = new Date(resolvedMs).toISOString();

      const state = this.getAdaptiveState();
      this.emit({
        type: "interval_adjusted",
        previousIntervalMs,
        newIntervalMs,
        reason: "manual_reset",
        state,
      });

      if (this.onIntervalAdjustedCallback) {
        void this.onIntervalAdjustedCallback(state);
      }

      if (this.isRunningState) {
        this.scheduleNextTick();
      }
    }
  }

  public async triggerReactiveWakeup(
    trigger?: ReactiveWakeupTrigger,
    currentTime?: string | number | Date,
  ): Promise<WatchdogTickReport> {
    const timeMs =
      typeof currentTime === "number"
        ? currentTime
        : currentTime instanceof Date
          ? currentTime.getTime()
          : typeof currentTime === "string"
            ? Date.parse(currentTime)
            : Date.now();
    const resolvedMs = Number.isFinite(timeMs) ? timeMs : Date.now();
    const isoTimestamp = new Date(resolvedMs).toISOString();

    const normalizedTrigger: ReactiveEvent =
      typeof trigger === "string"
        ? { type: trigger, timestamp: isoTimestamp }
        : trigger && typeof trigger === "object"
          ? {
              type: trigger.type,
              ...(trigger.source !== undefined ? { source: trigger.source } : {}),
              ...(trigger.taskId !== undefined ? { taskId: trigger.taskId } : {}),
              ...(trigger.agentId !== undefined ? { agentId: trigger.agentId } : {}),
              timestamp: trigger.timestamp ?? isoTimestamp,
              ...(trigger.payload !== undefined ? { payload: trigger.payload } : {}),
            }
          : { type: "reactive_wakeup", timestamp: isoTimestamp };

    if (normalizedTrigger.agentId) {
      this.recordActivity(
        normalizedTrigger.agentId,
        normalizedTrigger.taskId ?? undefined,
        resolvedMs,
      );
    }

    this.activeEventCountSinceLastTick++;

    if (this.adaptiveEnabled) {
      this.boostActivity(undefined, resolvedMs, "event_wakeup");
    }

    const tickReport = await this.tick(resolvedMs);

    if (this.isRunningState) {
      this.scheduleNextTick();
    }

    this.emit({
      type: "reactive_wakeup",
      trigger: normalizedTrigger,
      tickReport,
    });

    if (this.onReactiveWakeupCallback) {
      await this.onReactiveWakeupCallback(normalizedTrigger, tickReport);
    }

    return tickReport;
  }

  public async notifyEvent(
    event: ReactiveWakeupTrigger,
    currentTime?: string | number | Date,
  ): Promise<WatchdogTickReport> {
    const timeMs =
      typeof currentTime === "number"
        ? currentTime
        : currentTime instanceof Date
          ? currentTime.getTime()
          : typeof currentTime === "string"
            ? Date.parse(currentTime)
            : Date.now();
    const resolvedMs = Number.isFinite(timeMs) ? timeMs : Date.now();
    const isoTimestamp = new Date(resolvedMs).toISOString();

    const normalized: ReactiveEvent =
      typeof event === "string"
        ? { type: event, timestamp: isoTimestamp }
        : {
            type: event.type,
            ...(event.source !== undefined ? { source: event.source } : {}),
            ...(event.taskId !== undefined ? { taskId: event.taskId } : {}),
            ...(event.agentId !== undefined ? { agentId: event.agentId } : {}),
            timestamp: event.timestamp ?? isoTimestamp,
            ...(event.payload !== undefined ? { payload: event.payload } : {}),
          };

    this.emit({ type: "event_notified", event: normalized });
    if (normalized.type !== "event_notified") {
      this.emitCustom(normalized.type, normalized);
    }

    return await this.triggerReactiveWakeup(normalized, resolvedMs);
  }

  public async tick(currentTime?: string | number | Date): Promise<WatchdogTickReport> {
    this.tickCount++;
    const timeMs =
      typeof currentTime === "number"
        ? currentTime
        : currentTime instanceof Date
          ? currentTime.getTime()
          : typeof currentTime === "string"
            ? Date.parse(currentTime)
            : Date.now();
    const resolvedMs = Number.isFinite(timeMs) ? timeMs : Date.now();
    if (this.tickCount === 1 && !this.hasExplicitInitialStartedAt && currentTime !== undefined) {
      this.startedAtMs = resolvedMs;
    }
    const timestamp = new Date(resolvedMs).toISOString();
    const elapsedMs = resolvedMs - this.startedAtMs;

    const health = await this.runHealthAudit(resolvedMs);

    if (this.adaptiveEnabled) {
      if (
        this.activeEventCountSinceLastTick === 0 &&
        health.healthy &&
        health.activeLeasesCount === 0
      ) {
        this.decayIdle(undefined, resolvedMs, "idle_backoff");
      }
    }
    this.activeEventCountSinceLastTick = 0;

    const report: WatchdogTickReport = {
      tickCount: this.tickCount,
      timestamp,
      elapsedMs,
      intervalMs: this.currentIntervalMsState,
      health,
    };

    this.emit({ type: "tick", report });

    if (this.onHeartbeatCallback) {
      await this.onHeartbeatCallback(report);
    }

    return report;
  }

  public async renderCliStatusReport(currentTime?: string | number | Date): Promise<string> {
    const health = await this.runHealthAudit(currentTime);
    const bootGateTable = this.bootGateEnforcer.renderAsciiBootGateTable();

    const lines: string[] = [
      "### Autonomic Watchdog Status & Boot-Gate Enforcer",
      `- **Overall Health**: ${health.healthy ? "HEALTHY ✅" : "UNHEALTHY ❌"}`,
      `- **Active Leases / Monitors**: ${health.activeLeasesCount}`,
      `- **Stalled Agents**: ${health.stalledAgentsCount}`,
      `- **Dead / Terminated Processes**: ${health.deadProcessesCount}`,
      `- **Subagent Count**: ${health.subagentCount}`,
      `- **Boot-Gate Compliant**: ${health.bootGateCompliantCount}/${health.subagentCount}`,
      `- **Tier Violations**: ${health.tierViolationsCount}`,
      `- **Summary**: ${health.summary}`,
      "",
      "#### Subagent Pre-Flight Boot-Gate Status",
      bootGateTable,
    ];

    if (health.findings.length > 0) {
      lines.push("");
      lines.push("#### Active Watchdog Findings");
      for (const f of health.findings) {
        lines.push(`- [${f.severity.toUpperCase()}] **${f.violationType}**: ${f.observation}`);
      }
    }

    return lines.join("\n");
  }

  public start(): void {
    if (this.isRunningState) return;
    this.isRunningState = true;
    this.startedAtMs = Date.now();
    this.scheduleNextTick();
  }

  private scheduleNextTick(delayMs?: number): void {
    if (!this.isRunningState) return;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const delay = delayMs ?? this.currentIntervalMsState;
    this.timer = setTimeout(async () => {
      if (!this.isRunningState) return;
      try {
        await this.tick();
      } finally {
        if (this.isRunningState) {
          this.scheduleNextTick();
        }
      }
    }, delay);

    if (typeof this.timer === "object" && this.timer !== null && "unref" in this.timer) {
      (this.timer as { unref: () => void }).unref();
    }
  }

  public stop(): void {
    if (!this.isRunningState) return;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.isRunningState = false;
  }

  public dispose(): void {
    this.stop();
    this.activities.clear();
    this.listeners.clear();
    this.bootGateEnforcer.reset();
  }

  public isRunning(): boolean {
    return this.isRunningState;
  }

  public getTickCount(): number {
    return this.tickCount;
  }

  public on(event: string, listener: WatchdogEventListener): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return () => {
      this.off(event, listener);
    };
  }

  public off(event: string, listener: WatchdogEventListener): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  public addEventListener(event: string, listener: WatchdogEventListener): () => void {
    return this.on(event, listener);
  }

  public removeEventListener(event: string, listener: WatchdogEventListener): void {
    this.off(event, listener);
  }

  public emitCustomEvent(event: ReactiveEvent): void {
    this.emit({ type: "event_notified", event });
    if (event.type !== "event_notified") {
      this.emitCustom(event.type, event);
    }
  }

  private emit(event: WatchdogEvent): void {
    const specific = this.listeners.get(event.type);
    if (specific) {
      for (const listener of specific) {
        try {
          void listener(event);
        } catch {}
      }
    }
    const wildcard = this.listeners.get("*");
    if (wildcard) {
      for (const listener of wildcard) {
        try {
          void listener(event);
        } catch {}
      }
    }
  }

  private emitCustom(eventType: string, payload: ReactiveEvent | WatchdogEvent): void {
    const specific = this.listeners.get(eventType);
    if (specific) {
      for (const listener of specific) {
        try {
          void listener(payload);
        } catch {}
      }
    }
  }
}
