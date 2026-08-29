import {
  AdaptiveTimerController,
  type AdaptiveAdjustmentReason,
  type AdaptiveTimerConfig,
  type AdaptiveTimerState,
  type IntervalAdjustmentResult,
} from "../../core/scheduling/index.ts";
import { BootGateEnforcer } from "../boot-gate-enforcer/index.ts";
import {
  DEFAULT_ADAPTIVE_ACTIVITY_BOOST,
  DEFAULT_ADAPTIVE_BACKOFF_FACTOR,
  DEFAULT_ADAPTIVE_MAX_INTERVAL_MS,
  DEFAULT_ADAPTIVE_MIN_INTERVAL_MS,
  DEFAULT_HEALTH_AUDIT_INTERVAL_MS,
  DEFAULT_PROCESS_HEALTH_CHECK_INTERVAL_MS,
  DEFAULT_WATCHDOG_HEARTBEAT_INTERVAL_MS,
  DEFAULT_WATCHDOG_TIMEOUT_MS,
} from "../constants.ts";
import { ActivityTracker } from "./activity-tracker.ts";
import { formatCliStatusReport } from "./cli-reporter.ts";
import { WatchdogEventEmitter } from "./event-emitter.ts";
import { defaultProcessLivenessChecker, HealthAuditor } from "./health-auditor.ts";
import { normalizeReactiveTrigger, resolveTimestampMs } from "./reactive-dispatcher.ts";
import type {
  AutonomicWatchdogConfig,
  LiveCliProof,
  ProcessHealthStatus,
  ReactiveEvent,
  ReactiveWakeupTrigger,
  SubagentBootGateRecord,
  SubagentRegistrationOptions,
  WatchdogEventListener,
  WatchdogFinding,
  WatchdogHealthAuditReport,
  WatchdogTickReport,
} from "./types.ts";

export class AutonomicWatchdog {
  public readonly heartbeatIntervalMs: number;
  public readonly timeoutMs: number;
  public readonly healthAuditIntervalMs: number;
  public readonly processHealthCheckIntervalMs: number;
  public readonly capsuleRoot: string | null;
  public readonly generation: number;
  public readonly pulseId: string | null;
  public readonly enforcePreFlightGates: boolean;

  private readonly bootGateEnforcer = new BootGateEnforcer();
  private readonly activityTracker = new ActivityTracker(this.bootGateEnforcer);
  private readonly emitter = new WatchdogEventEmitter();
  private readonly adaptiveController: AdaptiveTimerController;
  private readonly healthAuditor: HealthAuditor;
  private readonly onHeartbeatCallback?: ((tick: WatchdogTickReport) => void | Promise<void>) | undefined;
  private readonly onHealthAuditCallback?: ((audit: WatchdogHealthAuditReport) => void | Promise<void>) | undefined;
  private readonly onViolationCallback?: ((finding: WatchdogFinding) => void | Promise<void>) | undefined;
  private readonly onReactiveWakeupCallback?: ((t: ReactiveEvent, r: WatchdogTickReport) => void | Promise<void>) | undefined;
  private readonly onIntervalAdjustedCallback?: ((state: AdaptiveTimerState) => void | Promise<void>) | undefined;

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
    this.processHealthCheckIntervalMs = config.processHealthCheckIntervalMs ?? DEFAULT_PROCESS_HEALTH_CHECK_INTERVAL_MS;
    this.capsuleRoot = config.capsuleRoot ?? null;
    this.generation = config.generation ?? 1;
    this.pulseId = config.pulseId ?? null;
    this.enforcePreFlightGates = config.enforcePreFlightGates !== false;
    this.onHeartbeatCallback = config.onHeartbeat;
    this.onHealthAuditCallback = config.onHealthAudit;
    this.onViolationCallback = config.onViolation;
    this.onReactiveWakeupCallback = config.onReactiveWakeup;
    this.onIntervalAdjustedCallback = config.onIntervalAdjusted;
    this.hasExplicitInitialStartedAt = config.initialStartedAt !== undefined;
    this.startedAtMs = resolveTimestampMs(config.initialStartedAt);
    const n = typeof config.adaptive === "object" && config.adaptive !== null ? config.adaptive : undefined;
    this.adaptiveController = new AdaptiveTimerController({
      minIntervalMs: n?.minIntervalMs ?? config.minIntervalMs ?? DEFAULT_ADAPTIVE_MIN_INTERVAL_MS,
      maxIntervalMs: n?.maxIntervalMs ?? config.maxIntervalMs ?? Math.max(DEFAULT_ADAPTIVE_MAX_INTERVAL_MS, this.heartbeatIntervalMs),
      backoffFactor: n?.backoffFactor ?? config.backoffFactor ?? DEFAULT_ADAPTIVE_BACKOFF_FACTOR,
      activityBoost: n?.activityBoost ?? config.activityBoost ?? DEFAULT_ADAPTIVE_ACTIVITY_BOOST,
      initialIntervalMs: n?.initialIntervalMs ?? config.heartbeatIntervalMs ?? DEFAULT_WATCHDOG_HEARTBEAT_INTERVAL_MS,
      heartbeatIntervalMs: this.heartbeatIntervalMs,
      enabled: config.adaptive !== false,
      initialStartedAt: this.startedAtMs,
    }, this.startedAtMs);
    this.healthAuditor = new HealthAuditor({
      timeoutMs: this.timeoutMs,
      capsuleRoot: this.capsuleRoot,
      bootGateEnforcer: this.bootGateEnforcer,
      activities: this.activityTracker.activities,
      processLivenessChecker: config.processLivenessChecker ?? defaultProcessLivenessChecker,
      onStallDetected: (agentId, finding) => this.emitter.emit({ type: "stall_detected", agentId, finding }),
      onProcessFailureDetected: (agentId, pid, finding) => this.emitter.emit({ type: "process_failure_detected", agentId, pid, finding }),
    });
  }

  public getBootGateEnforcer(): BootGateEnforcer { return this.bootGateEnforcer; }
  public registerSubagent(o: SubagentRegistrationOptions, now?: string | number | Date): SubagentBootGateRecord { return this.activityTracker.registerSubagent(o, now); }
  public recordWhoami(a: string, n?: string | number | Date, p?: Partial<LiveCliProof>): SubagentBootGateRecord { return this.activityTracker.recordWhoami(a, n, p); }
  public recordDoctor(a: string, n?: string | number | Date, p?: Partial<LiveCliProof>): SubagentBootGateRecord { return this.activityTracker.recordDoctor(a, n, p); }
  public recordCliProof(p: LiveCliProof, n?: string | number | Date): SubagentBootGateRecord | undefined { return this.activityTracker.recordCliProof(p, n); }
  public recordCommand(a: string, argv: readonly string[], n?: string | number | Date, exit?: number, pid?: number, s?: string): void { this.activityTracker.recordCommand(a, argv, n, exit, pid, s); }
  public recordHeartbeat(a: string, t?: string, n?: string | number | Date): void { this.activityTracker.recordHeartbeat(a, t, n); }
  public recordActivity(a: string, t?: string, n?: string | number | Date): void { this.activityTracker.recordActivity(a, t, n); }
  public checkProcessHealth(pid: number, a?: string, n?: string | number | Date): ProcessHealthStatus { return this.healthAuditor.checkProcessHealth(pid, a, n); }
  public auditProcessHealth(n?: string | number | Date): readonly ProcessHealthStatus[] { return this.healthAuditor.auditProcessHealth(n); }
  public assertBootGatesPassed(a: string, desc = "performing task operations", proof = false): void { this.bootGateEnforcer.assertBootGatesPassed(a, desc, proof); }
  public get currentIntervalMs(): number { return this.adaptiveController.currentIntervalMs; }
  public get minIntervalMs(): number { return this.adaptiveController.minIntervalMs; }
  public get maxIntervalMs(): number { return this.adaptiveController.maxIntervalMs; }
  public get backoffFactor(): number { return this.adaptiveController.backoffFactor; }
  public get activityBoost(): number { return this.adaptiveController.activityBoost; }
  public isAdaptive(): boolean { return this.adaptiveController.isAdaptive(); }
  public getCurrentIntervalMs(): number { return this.adaptiveController.currentIntervalMs; }
  public getAdaptiveState(): AdaptiveTimerState { return this.adaptiveController.getAdaptiveState(); }
  public configureAdaptiveTimers(config: Partial<AdaptiveTimerConfig>): void { this.adaptiveController.configureAdaptiveTimers(config); }
  public setAdaptiveBounds(bounds: Partial<AdaptiveTimerConfig>): void { this.adaptiveController.setAdaptiveBounds(bounds); }
  public boostActivity(multiplier?: number, now?: string | number | Date, reason: AdaptiveAdjustmentReason = "activity_burst"): number { return this.handleIntervalAdjustment(this.adaptiveController.boostActivity(multiplier, now, reason)); }
  public decayIdle(multiplier?: number, now?: string | number | Date, reason: AdaptiveAdjustmentReason = "idle_backoff"): number { return this.handleIntervalAdjustment(this.adaptiveController.decayIdle(multiplier, now, reason)); }
  public resetInterval(intervalMs?: number, now?: string | number | Date): void { this.handleIntervalAdjustment(this.adaptiveController.resetInterval(this.heartbeatIntervalMs, intervalMs, now)); }
  public isRunning(): boolean { return this.isRunningState; }
  public getTickCount(): number { return this.tickCount; }
  public on(event: string, listener: WatchdogEventListener): () => void { return this.emitter.on(event, listener); }
  public off(event: string, listener: WatchdogEventListener): void { this.emitter.off(event, listener); }
  public addEventListener(event: string, listener: WatchdogEventListener): () => void { return this.on(event, listener); }
  public removeEventListener(event: string, listener: WatchdogEventListener): void { this.off(event, listener); }
  public emitCustomEvent(event: ReactiveEvent): void { this.emitter.emitCustomEvent(event); }

  public async runHealthAudit(currentTime?: string | number | Date): Promise<WatchdogHealthAuditReport> {
    const report = await this.healthAuditor.auditHealth(currentTime);
    this.emitter.emit({ type: "health_audit", report });
    if (this.onHealthAuditCallback) await this.onHealthAuditCallback(report);
    for (const finding of report.findings) {
      if (finding.severity === "critical") this.emitter.emit({ type: "critical_violation", finding });
      if (this.onViolationCallback) await this.onViolationCallback(finding);
    }
    return report;
  }

  private handleIntervalAdjustment(result: IntervalAdjustmentResult): number {
    if (result.changed) {
      this.emitter.emit({ type: "interval_adjusted", previousIntervalMs: result.previousIntervalMs, newIntervalMs: result.newIntervalMs, reason: result.reason, state: result.state });
      if (this.onIntervalAdjustedCallback) void this.onIntervalAdjustedCallback(result.state);
      if (this.isRunningState) this.scheduleNextTick();
    }
    return result.newIntervalMs;
  }

  public async triggerReactiveWakeup(trigger?: ReactiveWakeupTrigger, currentTime?: string | number | Date): Promise<WatchdogTickReport> {
    const { normalized, resolvedMs } = normalizeReactiveTrigger(trigger, currentTime);
    if (normalized.agentId) this.activityTracker.recordActivity(normalized.agentId, normalized.taskId ?? undefined, resolvedMs);
    this.activeEventCountSinceLastTick++;
    if (this.adaptiveController.isAdaptive()) this.boostActivity(undefined, resolvedMs, "event_wakeup");
    const tickReport = await this.tick(resolvedMs);
    if (this.isRunningState) this.scheduleNextTick();
    this.emitter.emit({ type: "reactive_wakeup", trigger: normalized, tickReport });
    if (this.onReactiveWakeupCallback) await this.onReactiveWakeupCallback(normalized, tickReport);
    return tickReport;
  }

  public async notifyEvent(event: ReactiveWakeupTrigger, currentTime?: string | number | Date): Promise<WatchdogTickReport> {
    const { normalized, resolvedMs } = normalizeReactiveTrigger(event, currentTime);
    this.emitter.emit({ type: "event_notified", event: normalized });
    if (normalized.type !== "event_notified") this.emitter.emitCustom(normalized.type, normalized);
    return await this.triggerReactiveWakeup(normalized, resolvedMs);
  }

  public async tick(currentTime?: string | number | Date): Promise<WatchdogTickReport> {
    this.tickCount++;
    const resolvedMs = resolveTimestampMs(currentTime);
    if (this.tickCount === 1 && !this.hasExplicitInitialStartedAt && currentTime !== undefined) this.startedAtMs = resolvedMs;
    const timestamp = new Date(resolvedMs).toISOString();
    const elapsedMs = resolvedMs - this.startedAtMs;
    const health = await this.runHealthAudit(resolvedMs);

    if (this.adaptiveController.isAdaptive() && this.activeEventCountSinceLastTick === 0 && health.healthy && health.activeLeasesCount === 0) {
      this.decayIdle(undefined, resolvedMs, "idle_backoff");
    }
    this.activeEventCountSinceLastTick = 0;

    const report: WatchdogTickReport = { tickCount: this.tickCount, timestamp, elapsedMs, intervalMs: this.adaptiveController.currentIntervalMs, health };
    this.emitter.emit({ type: "tick", report });
    if (this.onHeartbeatCallback) await this.onHeartbeatCallback(report);
    return report;
  }

  public async renderCliStatusReport(currentTime?: string | number | Date): Promise<string> {
    const health = await this.runHealthAudit(currentTime);
    return formatCliStatusReport(health, this.bootGateEnforcer.renderAsciiBootGateTable());
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
    const delay = delayMs ?? this.adaptiveController.currentIntervalMs;
    this.timer = setTimeout(async () => {
      if (!this.isRunningState) return;
      try {
        await this.tick();
      } finally {
        if (this.isRunningState) this.scheduleNextTick();
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
    this.activityTracker.clear();
    this.emitter.clear();
    this.bootGateEnforcer.reset();
  }
}
