import { randomUUID } from "node:crypto";
import type { HarnessEvent } from "../contracts/capsule.ts";
import type { JsonObject, JsonValue } from "../contracts/json.ts";
import {
  calculateDrift,
  calculateDuration,
  formatDualTimeDisplay,
  formatDuration,
  getDualTime,
  isDualTimeRecord,
  type DualTimeRecord,
} from "../core/dual-time.ts";
import { HarnessError } from "../errors/harness-error.ts";

/**
 * Canonical action category domains across the 4-tier autonomous harness hierarchy.
 */
export type HarnessActionCategory =
  | "plan"
  | "queue"
  | "task"
  | "run"
  | "doctor"
  | "mind"
  | "watchdog"
  | "subagent"
  | "gate"
  | "workflow"
  | "custom";

/**
 * Execution lifecycle states for an action timing span.
 */
export type ActionExecutionStatus =
  | "pending"
  | "running"
  | "success"
  | "failure"
  | "error"
  | "timed_out";

/**
 * Valid action categories set for runtime validation.
 */
export const HARNESS_ACTION_CATEGORIES: readonly HarnessActionCategory[] = [
  "plan",
  "queue",
  "task",
  "run",
  "doctor",
  "mind",
  "watchdog",
  "subagent",
  "gate",
  "workflow",
  "custom",
] as const;

/**
 * Valid execution statuses set for runtime validation.
 */
export const ACTION_EXECUTION_STATUSES: readonly ActionExecutionStatus[] = [
  "pending",
  "running",
  "success",
  "failure",
  "error",
  "timed_out",
] as const;

/**
 * Command prefix to domain category and default authority tier mapping.
 */
interface CommandDomainMapping {
  readonly category: HarnessActionCategory;
  readonly defaultTier: number;
}

const COMMAND_PREFIX_MAP: Readonly<Record<string, CommandDomainMapping>> = {
  "mind:": { category: "mind", defaultTier: 0 },
  "memory:": { category: "mind", defaultTier: 0 },
  "feedback:": { category: "mind", defaultTier: 0 },
  "smart-task:": { category: "mind", defaultTier: 0 },
  orchestrate: { category: "plan", defaultTier: 1 },
  "plan:": { category: "plan", defaultTier: 2 },
  "dag:": { category: "plan", defaultTier: 2 },
  "queue:": { category: "queue", defaultTier: 2 },
  "task:": { category: "task", defaultTier: 3 },
  "run:": { category: "run", defaultTier: 3 },
  doctor: { category: "doctor", defaultTier: 1 },
  "doctor:": { category: "doctor", defaultTier: 1 },
  "watchdog:": { category: "watchdog", defaultTier: 1 },
  watchdog: { category: "watchdog", defaultTier: 1 },
  heartbeat: { category: "watchdog", defaultTier: 1 },
  "subagent:": { category: "subagent", defaultTier: 3 },
  "gate:": { category: "gate", defaultTier: 3 },
  "workflow:": { category: "workflow", defaultTier: 2 },
};

/**
 * Categorizes a harness command or action name and returns its canonical domain and authority tier.
 */
export function categorizeHarnessAction(actionName: string): {
  readonly category: HarnessActionCategory;
  readonly defaultTier: number;
} {
  const normalized = actionName.trim().toLowerCase();

  for (const [prefix, mapping] of Object.entries(COMMAND_PREFIX_MAP)) {
    if (normalized === prefix || normalized.startsWith(prefix)) {
      return mapping;
    }
  }

  if (normalized.includes("test") || normalized.includes("gate")) {
    return { category: "gate", defaultTier: 3 };
  }
  if (normalized.includes("watchdog") || normalized.includes("heartbeat")) {
    return { category: "watchdog", defaultTier: 1 };
  }
  if (normalized.includes("subagent") || normalized.includes("spawn")) {
    return { category: "subagent", defaultTier: 3 };
  }

  return { category: "custom", defaultTier: 3 };
}

/**
 * Sub-step timing detail within a parent action span.
 */
export interface SubStepTiming {
  readonly name: string;
  readonly startedAt: DualTimeRecord;
  readonly finishedAt?: DualTimeRecord | undefined;
  readonly durationMs?: number | undefined;
  readonly durationFormatted?: string | undefined;
  readonly status: ActionExecutionStatus;
  readonly details?: Readonly<Record<string, JsonValue>> | undefined;
}

/**
 * Immutable serializable action timing and dual-time telemetry record.
 */
export interface HarnessActionTimeRecord {
  readonly actionId: string;
  readonly actionName: string;
  readonly category: HarnessActionCategory;
  readonly actor: string;
  readonly tier: number;
  readonly status: ActionExecutionStatus;
  readonly startedAt: DualTimeRecord;
  readonly finishedAt?: DualTimeRecord | undefined;
  readonly durationMs?: number | undefined;
  readonly durationFormatted?: string | undefined;
  readonly driftMs?: number | undefined;
  readonly subSteps?: readonly SubStepTiming[] | undefined;
  readonly metadata?: Readonly<Record<string, JsonValue>> | undefined;
  readonly error?: string | undefined;
}

/**
 * Options for initiating an ActionSpan.
 */
export interface StartActionSpanOptions {
  readonly category?: HarnessActionCategory | undefined;
  readonly tier?: number | undefined;
  readonly startedAt?: Date | number | string | DualTimeRecord | undefined;
  readonly timezone?: string | undefined;
  readonly metadata?: Readonly<Record<string, JsonValue>> | undefined;
  readonly expectedStartMs?: number | undefined;
}

/**
 * Active timing span for wrapping and measuring harness actions in real time.
 */
export class ActionSpan {
  public readonly actionId: string;
  public readonly actionName: string;
  public readonly category: HarnessActionCategory;
  public readonly actor: string;
  public readonly tier: number;
  public readonly startedAt: DualTimeRecord;
  public readonly timezone: string;
  public readonly driftMs?: number | undefined;

  private _status: ActionExecutionStatus = "running";
  private _finishedAt?: DualTimeRecord | undefined;
  private _durationMs?: number | undefined;
  private _durationFormatted?: string | undefined;
  private _error?: string | undefined;
  private _metadata: Record<string, JsonValue>;
  private _subSteps: SubStepTiming[] = [];
  private _activeSubStep?:
    | {
        name: string;
        startedAt: DualTimeRecord;
        details?: Record<string, JsonValue> | undefined;
      }
    | undefined;

  public constructor(actionName: string, actor: string, options: StartActionSpanOptions = {}) {
    const classification = categorizeHarnessAction(actionName);
    this.actionId = randomUUID();
    this.actionName = actionName;
    this.actor = actor;
    this.category = options.category ?? classification.category;
    this.tier = options.tier ?? classification.defaultTier;

    const startedTime = getDualTime(options.startedAt, options.timezone);
    this.startedAt = startedTime;
    this.timezone = startedTime.timezone;

    if (options.expectedStartMs !== undefined) {
      this.driftMs = calculateDrift(options.expectedStartMs, startedTime.timestamp_ms);
    }

    this._metadata = options.metadata ? { ...options.metadata } : {};
  }

  public get status(): ActionExecutionStatus {
    return this._status;
  }

  public get finishedAt(): DualTimeRecord | undefined {
    return this._finishedAt;
  }

  public get durationMs(): number | undefined {
    return this._durationMs;
  }

  public get durationFormatted(): string | undefined {
    return this._durationFormatted;
  }

  public get error(): string | undefined {
    return this._error;
  }

  public get metadata(): Readonly<Record<string, JsonValue>> {
    return this._metadata;
  }

  public get subSteps(): readonly SubStepTiming[] {
    return this._subSteps;
  }

  /**
   * Starts an internal sub-step measurement.
   */
  public startSubStep(
    name: string,
    details?: Record<string, JsonValue>,
    timestamp?: Date | number | string | DualTimeRecord,
  ): void {
    if (this._activeSubStep) {
      this.finishSubStep("success");
    }
    const started = getDualTime(timestamp, this.timezone);
    this._activeSubStep = {
      name,
      startedAt: started,
      details: details ? { ...details } : undefined,
    };
  }

  /**
   * Finishes the currently active internal sub-step.
   */
  public finishSubStep(
    status: ActionExecutionStatus = "success",
    details?: Record<string, JsonValue>,
    timestamp?: Date | number | string | DualTimeRecord,
  ): void {
    if (!this._activeSubStep) return;

    const finished = getDualTime(timestamp, this.timezone);
    const dur = calculateDuration(this._activeSubStep.startedAt, finished);

    const mergedDetails =
      details !== undefined || this._activeSubStep.details !== undefined
        ? { ...(this._activeSubStep.details ?? {}), ...(details ?? {}) }
        : undefined;

    this._subSteps.push({
      name: this._activeSubStep.name,
      startedAt: this._activeSubStep.startedAt,
      finishedAt: finished,
      durationMs: dur.duration_ms,
      durationFormatted: dur.formatted,
      status,
      details: mergedDetails,
    });

    this._activeSubStep = undefined;
  }

  /**
   * Completes the action span with success or explicit status.
   */
  public finish(
    status: ActionExecutionStatus = "success",
    metadata?: Record<string, JsonValue>,
    timestamp?: Date | number | string | DualTimeRecord,
  ): HarnessActionTimeRecord {
    if (this._activeSubStep) {
      this.finishSubStep(status);
    }

    this._status = status;
    this._finishedAt = getDualTime(timestamp, this.timezone);
    const calc = calculateDuration(this.startedAt, this._finishedAt);
    this._durationMs = calc.duration_ms;
    this._durationFormatted = calc.formatted;

    if (metadata) {
      this._metadata = { ...this._metadata, ...metadata };
    }

    return this.toRecord();
  }

  /**
   * Completes the action span with an error or failure state.
   */
  public fail(
    error: string | Error,
    metadata?: Record<string, JsonValue>,
    timestamp?: Date | number | string | DualTimeRecord,
  ): HarnessActionTimeRecord {
    const errorMsg = error instanceof Error ? error.message : String(error);
    this._error = errorMsg;
    return this.finish("error", { ...(metadata ?? {}), error: errorMsg }, timestamp);
  }

  /**
   * Produces an immutable snapshot record of this action span.
   */
  public toRecord(): HarnessActionTimeRecord {
    return {
      actionId: this.actionId,
      actionName: this.actionName,
      category: this.category,
      actor: this.actor,
      tier: this.tier,
      status: this._status,
      startedAt: this.startedAt,
      finishedAt: this._finishedAt,
      durationMs: this._durationMs,
      durationFormatted: this._durationFormatted,
      driftMs: this.driftMs,
      subSteps: this._subSteps.length > 0 ? [...this._subSteps] : undefined,
      metadata: Object.keys(this._metadata).length > 0 ? { ...this._metadata } : undefined,
      error: this._error,
    };
  }
}

/**
 * Statistical latency percentiles structure.
 */
export interface LatencyPercentiles {
  readonly count: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p90Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
}

/**
 * Categorical breakdown summary.
 */
export interface CategoryTelemetrySummary {
  readonly category: HarnessActionCategory;
  readonly count: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly errorRate: number;
  readonly totalDurationMs: number;
  readonly meanDurationMs: number;
  readonly maxDurationMs: number;
  readonly percentiles: LatencyPercentiles;
}

/**
 * Per-actor summary.
 */
export interface ActorTelemetrySummary {
  readonly actor: string;
  readonly tier: number;
  readonly count: number;
  readonly totalDurationMs: number;
  readonly meanDurationMs: number;
  readonly errorCount: number;
}

/**
 * Behavioral time anomaly detected during telemetry analysis.
 */
export interface TimeAnomaly {
  readonly type:
    | "excessive_duration"
    | "negative_duration"
    | "clock_drift"
    | "orphaned_span"
    | "unclosed_substep";
  readonly severity: "low" | "medium" | "high" | "critical";
  readonly actionId: string;
  readonly actionName: string;
  readonly actor: string;
  readonly message: string;
  readonly thresholdMs?: number | undefined;
  readonly actualMs?: number | undefined;
}

/**
 * Health assessment result for a collection of time telemetry records.
 */
export interface TimeTelemetryHealthResult {
  readonly healthy: boolean;
  readonly totalChecked: number;
  readonly anomalyCount: number;
  readonly anomalies: readonly TimeAnomaly[];
  readonly recommendation: string;
}

/**
 * Comprehensive omnipresent time telemetry report.
 */
export interface TimeTelemetryReport {
  readonly generatedAt: DualTimeRecord;
  readonly runId?: string | undefined;
  readonly totalActions: number;
  readonly activeActions: number;
  readonly completedActions: number;
  readonly totalDurationMs: number;
  readonly overallPercentiles: LatencyPercentiles;
  readonly categoryBreakdown: readonly CategoryTelemetrySummary[];
  readonly actorBreakdown: readonly ActorTelemetrySummary[];
  readonly recentActions: readonly HarnessActionTimeRecord[];
  readonly anomalies: readonly TimeAnomaly[];
  readonly timezone: string;
}

/**
 * Filter options for querying recorded telemetry records.
 */
export interface TelemetryFilter {
  readonly category?: HarnessActionCategory | readonly HarnessActionCategory[] | undefined;
  readonly actor?: string | readonly string[] | undefined;
  readonly tier?: number | readonly number[] | undefined;
  readonly status?: ActionExecutionStatus | readonly ActionExecutionStatus[] | undefined;
  readonly actionName?: string | readonly string[] | undefined;
  readonly fromMs?: number | undefined;
  readonly toMs?: number | undefined;
}

/**
 * Computes min, max, mean, and standard latency percentiles from a series of durations in ms.
 */
export function computeLatencyPercentiles(durationsMs: readonly number[]): LatencyPercentiles {
  if (durationsMs.length === 0) {
    return {
      count: 0,
      minMs: 0,
      maxMs: 0,
      meanMs: 0,
      p50Ms: 0,
      p90Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
    };
  }

  const sorted = [...durationsMs].sort((a, b) => a - b);
  const count = sorted.length;
  const minMs = sorted[0]!;
  const maxMs = sorted[count - 1]!;
  const total = sorted.reduce((sum, val) => sum + val, 0);
  const meanMs = Math.round((total / count) * 100) / 100;

  const getPercentile = (p: number): number => {
    if (count === 1) return sorted[0]!;
    const index = Math.ceil((p / 100) * count) - 1;
    const clamped = Math.max(0, Math.min(index, count - 1));
    return sorted[clamped]!;
  };

  return {
    count,
    minMs,
    maxMs,
    meanMs,
    p50Ms: getPercentile(50),
    p90Ms: getPercentile(90),
    p95Ms: getPercentile(95),
    p99Ms: getPercentile(99),
  };
}

/**
 * Omnipresent Time Telemetry Collector managing active action spans and historical action records.
 */
export class OmnipresentTelemetryCollector {
  private readonly _activeSpans = new Map<string, ActionSpan>();
  private readonly _completedRecords: HarnessActionTimeRecord[] = [];
  private readonly _defaultTimezone?: string | undefined;

  public constructor(options?: { defaultTimezone?: string }) {
    this._defaultTimezone = options?.defaultTimezone;
  }

  /**
   * Starts a new measured action span.
   */
  public startSpan(
    actionName: string,
    actor: string,
    options?: StartActionSpanOptions,
  ): ActionSpan {
    const span = new ActionSpan(actionName, actor, {
      timezone: this._defaultTimezone,
      ...options,
    });
    this._activeSpans.set(span.actionId, span);
    return span;
  }

  /**
   * Finishes an active span by ID and stores the completed record.
   */
  public finishSpan(
    actionId: string,
    status: ActionExecutionStatus = "success",
    metadata?: Record<string, JsonValue>,
    timestamp?: Date | number | string | DualTimeRecord,
  ): HarnessActionTimeRecord {
    const span = this._activeSpans.get(actionId);
    if (!span) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `No active action span found with ID: ${actionId}`,
      );
    }

    const record = span.finish(status, metadata, timestamp);
    this._activeSpans.delete(actionId);
    this._completedRecords.push(record);
    return record;
  }

  /**
   * Records an already completed or external action telemetry record directly.
   */
  public recordAction(record: HarnessActionTimeRecord): void {
    if (!isHarnessActionTimeRecord(record)) {
      throw new HarnessError("INVALID_ARGUMENT", "Invalid HarnessActionTimeRecord provided.");
    }
    this._completedRecords.push(record);
  }

  /**
   * Records a command execution action span in a single call.
   */
  public recordCommandExecution(
    command: string,
    actor: string,
    startedAt: Date | number | string | DualTimeRecord,
    finishedAt: Date | number | string | DualTimeRecord,
    exitCode: number,
    details?: Record<string, JsonValue>,
  ): HarnessActionTimeRecord {
    const startDual = getDualTime(startedAt, this._defaultTimezone);
    const finishDual = getDualTime(finishedAt, this._defaultTimezone);
    const dur = calculateDuration(startDual, finishDual);
    const status: ActionExecutionStatus = exitCode === 0 ? "success" : "failure";

    const record: HarnessActionTimeRecord = {
      actionId: randomUUID(),
      actionName: "run:exec",
      category: "run",
      actor,
      tier: 3,
      status,
      startedAt: startDual,
      finishedAt: finishDual,
      durationMs: dur.duration_ms,
      durationFormatted: dur.formatted,
      metadata: {
        command,
        exitCode,
        ...(details ?? {}),
      },
    };

    this._completedRecords.push(record);
    return record;
  }

  /**
   * Records a gate / test execution with pass/fail metrics.
   */
  public recordGateExecution(
    gateCommand: string,
    actor: string,
    startedAt: Date | number | string | DualTimeRecord,
    finishedAt: Date | number | string | DualTimeRecord,
    passed: boolean,
    details?: Record<string, JsonValue>,
  ): HarnessActionTimeRecord {
    const startDual = getDualTime(startedAt, this._defaultTimezone);
    const finishDual = getDualTime(finishedAt, this._defaultTimezone);
    const dur = calculateDuration(startDual, finishDual);
    const status: ActionExecutionStatus = passed ? "success" : "failure";

    const record: HarnessActionTimeRecord = {
      actionId: randomUUID(),
      actionName: "gate:check",
      category: "gate",
      actor,
      tier: 3,
      status,
      startedAt: startDual,
      finishedAt: finishDual,
      durationMs: dur.duration_ms,
      durationFormatted: dur.formatted,
      metadata: {
        gateCommand,
        passed,
        ...(details ?? {}),
      },
    };

    this._completedRecords.push(record);
    return record;
  }

  /**
   * Records a supervisory watchdog heartbeat tick with drift measurement.
   */
  public recordWatchdogHeartbeat(
    component: string,
    actor: string,
    intervalMs: number,
    expectedTickMs: number,
    actualTick: Date | number | string | DualTimeRecord = new Date(),
    details?: Record<string, JsonValue>,
  ): HarnessActionTimeRecord {
    const actualDual = getDualTime(actualTick, this._defaultTimezone);
    const driftMs = calculateDrift(expectedTickMs, actualDual.timestamp_ms);

    const record: HarnessActionTimeRecord = {
      actionId: randomUUID(),
      actionName: `watchdog:heartbeat:${component}`,
      category: "watchdog",
      actor,
      tier: 1,
      status: "success",
      startedAt: actualDual,
      finishedAt: actualDual,
      durationMs: 0,
      durationFormatted: "0ms",
      driftMs,
      metadata: {
        component,
        intervalMs,
        expectedTickMs,
        actualTickMs: actualDual.timestamp_ms,
        ...(details ?? {}),
      },
    };

    this._completedRecords.push(record);
    return record;
  }

  /**
   * Returns all completed records matching the optional filter.
   */
  public getRecords(filter?: TelemetryFilter): readonly HarnessActionTimeRecord[] {
    if (!filter) {
      return [...this._completedRecords];
    }

    const catSet = filter.category
      ? new Set(Array.isArray(filter.category) ? filter.category : [filter.category])
      : null;
    const actorSet = filter.actor
      ? new Set(
          (Array.isArray(filter.actor) ? filter.actor : [filter.actor]).map((a) => a.toLowerCase()),
        )
      : null;
    const tierSet = filter.tier
      ? new Set(Array.isArray(filter.tier) ? filter.tier : [filter.tier])
      : null;
    const statusSet = filter.status
      ? new Set(Array.isArray(filter.status) ? filter.status : [filter.status])
      : null;
    const nameSet = filter.actionName
      ? new Set(Array.isArray(filter.actionName) ? filter.actionName : [filter.actionName])
      : null;

    return this._completedRecords.filter((rec) => {
      if (catSet && !catSet.has(rec.category)) return false;
      if (actorSet && !actorSet.has(rec.actor.toLowerCase())) return false;
      if (tierSet && !tierSet.has(rec.tier)) return false;
      if (statusSet && !statusSet.has(rec.status)) return false;
      if (nameSet && !nameSet.has(rec.actionName)) return false;
      if (filter.fromMs !== undefined && rec.startedAt.timestamp_ms < filter.fromMs) return false;
      if (filter.toMs !== undefined && rec.startedAt.timestamp_ms > filter.toMs) return false;
      return true;
    });
  }

  /**
   * Returns the count of currently active spans.
   */
  public getActiveSpanCount(): number {
    return this._activeSpans.size;
  }

  /**
   * Generates a complete comprehensive telemetry report.
   */
  public generateReport(options?: {
    runId?: string;
    filter?: TelemetryFilter;
    timezone?: string;
    maxRecent?: number;
  }): TimeTelemetryReport {
    const tz = options?.timezone ?? this._defaultTimezone ?? "UTC";
    const generatedAt = getDualTime(new Date(), tz);
    const records = this.getRecords(options?.filter);
    const activeCount = this._activeSpans.size;
    const completedCount = records.length;

    const durations = records
      .map((r) => r.durationMs)
      .filter((d): d is number => typeof d === "number");

    const totalDurationMs = durations.reduce((sum, d) => sum + d, 0);
    const overallPercentiles = computeLatencyPercentiles(durations);

    // Group by category
    const catMap = new Map<HarnessActionCategory, HarnessActionTimeRecord[]>();
    for (const rec of records) {
      const list = catMap.get(rec.category) ?? [];
      list.push(rec);
      catMap.set(rec.category, list);
    }

    const categoryBreakdown: CategoryTelemetrySummary[] = [];
    for (const cat of HARNESS_ACTION_CATEGORIES) {
      const catRecords = catMap.get(cat);
      if (!catRecords || catRecords.length === 0) continue;

      const catDurations = catRecords
        .map((r) => r.durationMs)
        .filter((d): d is number => typeof d === "number");
      const catTotalDur = catDurations.reduce((sum, d) => sum + d, 0);
      const catCount = catRecords.length;
      const successCount = catRecords.filter(
        (r) => r.status === "success" || r.status === "pending",
      ).length;
      const failureCount = catRecords.filter(
        (r) => r.status === "failure" || r.status === "error" || r.status === "timed_out",
      ).length;
      const errorRate = catCount > 0 ? Math.round((failureCount / catCount) * 10000) / 100 : 0;
      const maxDur = catDurations.length > 0 ? Math.max(...catDurations) : 0;
      const meanDur =
        catDurations.length > 0 ? Math.round((catTotalDur / catDurations.length) * 100) / 100 : 0;

      categoryBreakdown.push({
        category: cat,
        count: catCount,
        successCount,
        failureCount,
        errorRate,
        totalDurationMs: catTotalDur,
        meanDurationMs: meanDur,
        maxDurationMs: maxDur,
        percentiles: computeLatencyPercentiles(catDurations),
      });
    }

    // Group by actor
    const actorMap = new Map<string, HarnessActionTimeRecord[]>();
    for (const rec of records) {
      const list = actorMap.get(rec.actor) ?? [];
      list.push(rec);
      actorMap.set(rec.actor, list);
    }

    const actorBreakdown: ActorTelemetrySummary[] = [];
    for (const [actor, actRecords] of actorMap.entries()) {
      const actDurations = actRecords
        .map((r) => r.durationMs)
        .filter((d): d is number => typeof d === "number");
      const actTotalDur = actDurations.reduce((sum, d) => sum + d, 0);
      const actCount = actRecords.length;
      const actMean =
        actDurations.length > 0 ? Math.round((actTotalDur / actDurations.length) * 100) / 100 : 0;
      const errCount = actRecords.filter(
        (r) => r.status === "failure" || r.status === "error" || r.status === "timed_out",
      ).length;
      const tier = actRecords[0]?.tier ?? 3;

      actorBreakdown.push({
        actor,
        tier,
        count: actCount,
        totalDurationMs: actTotalDur,
        meanDurationMs: actMean,
        errorCount: errCount,
      });
    }

    // Sort breakdowns
    categoryBreakdown.sort((a, b) => b.totalDurationMs - a.totalDurationMs);
    actorBreakdown.sort((a, b) => b.count - a.count);

    // Recent actions
    const maxRecent = options?.maxRecent ?? 50;
    const recentActions = [...records].reverse().slice(0, maxRecent);

    // Anomalies
    const health = validateTimeTelemetryHealth(records);

    return {
      generatedAt,
      runId: options?.runId,
      totalActions: completedCount + activeCount,
      activeActions: activeCount,
      completedActions: completedCount,
      totalDurationMs,
      overallPercentiles,
      categoryBreakdown,
      actorBreakdown,
      recentActions,
      anomalies: health.anomalies,
      timezone: tz,
    };
  }

  /**
   * Resets all active spans and completed records.
   */
  public clear(): void {
    this._activeSpans.clear();
    this._completedRecords.length = 0;
  }
}

/**
 * Validates the behavioral health and temporal consistency of telemetry records.
 */
export function validateTimeTelemetryHealth(
  records: readonly HarnessActionTimeRecord[],
  thresholds?: {
    readonly maxDurationMs?: number | undefined;
    readonly maxDriftMs?: number | undefined;
  },
): TimeTelemetryHealthResult {
  const anomalies: TimeAnomaly[] = [];
  const maxDurationThreshold = thresholds?.maxDurationMs ?? 600_000; // 10 minutes default
  const maxDriftThreshold = thresholds?.maxDriftMs ?? 15_000; // 15 seconds default

  for (const rec of records) {
    if (typeof rec.durationMs === "number") {
      if (rec.durationMs < 0) {
        anomalies.push({
          type: "negative_duration",
          severity: "critical",
          actionId: rec.actionId,
          actionName: rec.actionName,
          actor: rec.actor,
          message: `Action recorded negative duration: ${rec.durationMs}ms`,
          actualMs: rec.durationMs,
        });
      } else if (rec.durationMs > maxDurationThreshold) {
        anomalies.push({
          type: "excessive_duration",
          severity: "medium",
          actionId: rec.actionId,
          actionName: rec.actionName,
          actor: rec.actor,
          message: `Action execution exceeded duration threshold: ${rec.durationFormatted ?? `${rec.durationMs}ms`}`,
          thresholdMs: maxDurationThreshold,
          actualMs: rec.durationMs,
        });
      }
    }

    if (typeof rec.driftMs === "number" && Math.abs(rec.driftMs) > maxDriftThreshold) {
      anomalies.push({
        type: "clock_drift",
        severity: "high",
        actionId: rec.actionId,
        actionName: rec.actionName,
        actor: rec.actor,
        message: `Watchdog heartbeat drift exceeded threshold: ${rec.driftMs}ms`,
        thresholdMs: maxDriftThreshold,
        actualMs: rec.driftMs,
      });
    }

    if (rec.subSteps) {
      for (const sub of rec.subSteps) {
        if (!sub.finishedAt) {
          anomalies.push({
            type: "unclosed_substep",
            severity: "low",
            actionId: rec.actionId,
            actionName: `${rec.actionName} > ${sub.name}`,
            actor: rec.actor,
            message: `Sub-step '${sub.name}' was not properly closed.`,
          });
        }
      }
    }
  }

  const healthy =
    anomalies.filter((a) => a.severity === "high" || a.severity === "critical").length === 0;
  const recommendation = healthy
    ? "Time telemetry healthy: all actions adhere to dual-time temporal invariants."
    : `Temporal health degraded: detected ${anomalies.length} timing anomalies requiring inspection.`;

  return {
    healthy,
    totalChecked: records.length,
    anomalyCount: anomalies.length,
    anomalies,
    recommendation,
  };
}

/**
 * Injects dual-time stamp and telemetry metadata into any arbitrary JSON payload.
 */
export function enrichWithDualTime<T extends JsonObject>(
  payload: T,
  timezone?: string,
): T & { readonly _dual_time: DualTimeRecord; readonly _telemetry_id: string } {
  const timeRecord = getDualTime(undefined, timezone);
  const telemetryId = randomUUID();

  return {
    ...payload,
    _dual_time: timeRecord,
    _telemetry_id: telemetryId,
  };
}

/**
 * Enriches a HarnessEvent with standard dual-time record.
 */
export function enrichHarnessEvent(
  event: HarnessEvent,
  timezone?: string,
): HarnessEvent & { readonly dual_time: DualTimeRecord } {
  const eventTime = getDualTime(event.timestamp, timezone);
  return {
    ...event,
    dual_time: eventTime as unknown as JsonValue,
  } as unknown as HarnessEvent & { readonly dual_time: DualTimeRecord };
}

/**
 * Extracts and verifies a DualTimeRecord from any candidate object.
 */
export function extractDualTime(source: unknown): DualTimeRecord | null {
  if (!source || typeof source !== "object") return null;

  const obj = source as Record<string, unknown>;

  if (isDualTimeRecord(obj)) {
    return obj;
  }

  if (isDualTimeRecord(obj._dual_time)) {
    return obj._dual_time;
  }

  if (isDualTimeRecord(obj.dual_time)) {
    return obj.dual_time;
  }

  if (isDualTimeRecord(obj.timestamp)) {
    return obj.timestamp;
  }

  if (typeof obj.timestamp === "string" || typeof obj.created_at === "string") {
    try {
      const str = (typeof obj.timestamp === "string" ? obj.timestamp : obj.created_at) as string;
      return getDualTime(str);
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Renders a Markdown header banner with dual-time timestamp.
 */
export function renderDualTimeHeader(title: string, record?: DualTimeRecord): string {
  const dual = record ?? getDualTime();
  const display = formatDualTimeDisplay(dual);
  return `# ${title}\n> **Generated At**: \`${display}\` (UTC: \`${dual.utc}\`)\n`;
}

/**
 * Formats a collection of action records as an omnipresent Markdown table.
 */
export function formatDualTimeTable(
  records: readonly HarnessActionTimeRecord[],
  options?: { timezone?: string; maxRows?: number },
): string {
  if (records.length === 0) {
    return "_No time telemetry records found._\n";
  }

  const maxRows = options?.maxRows ?? 50;
  const slice = records.slice(0, maxRows);

  const lines: string[] = [
    "| Action | Category | Actor | Tier | Status | Started (Local) | Duration | Drift |",
    "| :--- | :--- | :--- | :---: | :---: | :--- | :---: | :---: |",
  ];

  for (const rec of slice) {
    const startedDisplay = rec.startedAt.local.replace("T", " ");
    const duration =
      rec.durationFormatted ?? (rec.durationMs !== undefined ? `${rec.durationMs}ms` : "-");
    const drift = rec.driftMs !== undefined ? `${rec.driftMs > 0 ? "+" : ""}${rec.driftMs}ms` : "-";
    const statusIcon =
      rec.status === "success"
        ? "✅ success"
        : rec.status === "running"
          ? "🏃 running"
          : rec.status === "failure"
            ? "❌ failure"
            : rec.status === "error"
              ? "💥 error"
              : rec.status === "timed_out"
                ? "⏰ timed_out"
                : "⏳ pending";

    lines.push(
      `| \`${rec.actionName}\` | \`${rec.category}\` | \`${rec.actor}\` | ${rec.tier} | ${statusIcon} | \`${startedDisplay}\` | ${duration} | ${drift} |`,
    );
  }

  if (records.length > maxRows) {
    lines.push(`\n_... showing ${maxRows} of ${records.length} records._\n`);
  }

  return lines.join("\n");
}

/**
 * Renders a full markdown brief from a TimeTelemetryReport.
 */
export function renderOmnipresentTelemetryMarkdown(report: TimeTelemetryReport): string {
  const lines: string[] = [];

  lines.push(
    renderDualTimeHeader("Omnipresent Time Telemetry & Dual-Time Report", report.generatedAt),
  );

  lines.push("## Overview & Statistical Profile");
  lines.push(`- **Timezone**: \`${report.timezone}\``);
  lines.push(
    `- **Total Actions**: \`${report.totalActions}\` (Active: \`${report.activeActions}\`, Completed: \`${report.completedActions}\`)`,
  );
  lines.push(`- **Total Aggregate Duration**: \`${formatDuration(report.totalDurationMs)}\``);
  lines.push(`- **Mean Action Duration**: \`${formatDuration(report.overallPercentiles.meanMs)}\``);
  lines.push(
    `- **Latency Percentiles**: \`p50=${report.overallPercentiles.p50Ms}ms\`, \`p90=${report.overallPercentiles.p90Ms}ms\`, \`p95=${report.overallPercentiles.p95Ms}ms\`, \`p99=${report.overallPercentiles.p99Ms}ms\`, \`max=${report.overallPercentiles.maxMs}ms\``,
  );
  lines.push("");

  if (report.categoryBreakdown.length > 0) {
    lines.push("## Domain Category Breakdown");
    lines.push(
      "| Category | Count | Success | Failure | Error Rate | Total Time | Mean Time | p95 Latency |",
    );
    lines.push("| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |");
    for (const cat of report.categoryBreakdown) {
      lines.push(
        `| \`${cat.category}\` | ${cat.count} | ${cat.successCount} | ${cat.failureCount} | ${cat.errorRate}% | ${formatDuration(cat.totalDurationMs)} | ${formatDuration(cat.meanDurationMs)} | ${cat.percentiles.p95Ms}ms |`,
      );
    }
    lines.push("");
  }

  if (report.actorBreakdown.length > 0) {
    lines.push("## Agent & Authority Tier Breakdown");
    lines.push("| Actor | Tier | Actions | Total Time | Mean Time | Errors |");
    lines.push("| :--- | :---: | :---: | :---: | :---: | :---: |");
    for (const act of report.actorBreakdown) {
      lines.push(
        `| \`${act.actor}\` | Tier ${act.tier} | ${act.count} | ${formatDuration(act.totalDurationMs)} | ${formatDuration(act.meanDurationMs)} | ${act.errorCount} |`,
      );
    }
    lines.push("");
  }

  if (report.anomalies.length > 0) {
    lines.push("## Temporal Invariant & Health Anomalies");
    for (const anom of report.anomalies) {
      const badge =
        anom.severity === "critical"
          ? "🚨 CRITICAL"
          : anom.severity === "high"
            ? "⚠️ HIGH"
            : anom.severity === "medium"
              ? "⚡ MEDIUM"
              : "ℹ️ LOW";
      lines.push(`- **[${badge}]** \`${anom.actionName}\` (\`${anom.actor}\`): ${anom.message}`);
    }
    lines.push("");
  }

  if (report.recentActions.length > 0) {
    lines.push("## Recent Telemetry Activity Stream");
    lines.push(
      formatDualTimeTable(report.recentActions, { timezone: report.timezone, maxRows: 15 }),
    );
  }

  return lines.join("\n");
}

// ---------------------------------------------------------
// Strict Type Guards
// ---------------------------------------------------------

export function isHarnessActionCategory(value: unknown): value is HarnessActionCategory {
  return (
    typeof value === "string" && HARNESS_ACTION_CATEGORIES.includes(value as HarnessActionCategory)
  );
}

export function isActionExecutionStatus(value: unknown): value is ActionExecutionStatus {
  return (
    typeof value === "string" && ACTION_EXECUTION_STATUSES.includes(value as ActionExecutionStatus)
  );
}

export function isHarnessActionTimeRecord(value: unknown): value is HarnessActionTimeRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;

  if (typeof rec.actionId !== "string" || typeof rec.actionName !== "string") return false;
  if (!isHarnessActionCategory(rec.category)) return false;
  if (typeof rec.actor !== "string" || typeof rec.tier !== "number") return false;
  if (!isActionExecutionStatus(rec.status)) return false;
  if (!isDualTimeRecord(rec.startedAt)) return false;

  if (rec.finishedAt !== undefined && !isDualTimeRecord(rec.finishedAt)) return false;
  if (rec.durationMs !== undefined && typeof rec.durationMs !== "number") return false;
  if (rec.durationFormatted !== undefined && typeof rec.durationFormatted !== "string")
    return false;
  if (rec.driftMs !== undefined && typeof rec.driftMs !== "number") return false;
  if (rec.error !== undefined && typeof rec.error !== "string") return false;

  if (rec.subSteps !== undefined) {
    if (!Array.isArray(rec.subSteps)) return false;
    for (const sub of rec.subSteps) {
      if (typeof sub !== "object" || sub === null) return false;
      const s = sub as Record<string, unknown>;
      if (typeof s.name !== "string" || !isDualTimeRecord(s.startedAt)) return false;
      if (!isActionExecutionStatus(s.status)) return false;
    }
  }

  return true;
}

export function isTimeTelemetryReport(value: unknown): value is TimeTelemetryReport {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;

  return (
    isDualTimeRecord(rec.generatedAt) &&
    typeof rec.totalActions === "number" &&
    typeof rec.activeActions === "number" &&
    typeof rec.completedActions === "number" &&
    typeof rec.totalDurationMs === "number" &&
    typeof rec.timezone === "string" &&
    Array.isArray(rec.categoryBreakdown) &&
    Array.isArray(rec.actorBreakdown) &&
    Array.isArray(rec.recentActions) &&
    Array.isArray(rec.anomalies)
  );
}

export function isTimeTelemetryHealthResult(value: unknown): value is TimeTelemetryHealthResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;

  return (
    typeof rec.healthy === "boolean" &&
    typeof rec.totalChecked === "number" &&
    typeof rec.anomalyCount === "number" &&
    Array.isArray(rec.anomalies) &&
    typeof rec.recommendation === "string"
  );
}
