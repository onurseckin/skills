/**
 * Action Span & Timing Measurement Mechanics
 */
import { randomUUID } from "node:crypto";
import type { JsonValue } from "../../core/contracts/index.ts";
import {
  calculateDrift,
  calculateDuration,
  getDualTime,
  type DualTimeRecord,
} from "../../core/dual-time/index.ts";
import type {
  ActionExecutionStatus,
  HarnessActionCategory,
  HarnessActionTimeRecord,
  LatencyPercentiles,
  StartActionSpanOptions,
  SubStepTiming,
} from "./types.ts";

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

  public fail(
    error: string | Error,
    metadata?: Record<string, JsonValue>,
    timestamp?: Date | number | string | DualTimeRecord,
  ): HarnessActionTimeRecord {
    const errorMsg = error instanceof Error ? error.message : String(error);
    this._error = errorMsg;
    return this.finish("error", { ...(metadata ?? {}), error: errorMsg }, timestamp);
  }

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
