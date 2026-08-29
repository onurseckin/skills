import {
  DEFAULT_ADAPTIVE_ACTIVITY_BOOST,
  DEFAULT_ADAPTIVE_BACKOFF_FACTOR,
  DEFAULT_ADAPTIVE_MAX_INTERVAL_MS,
  DEFAULT_ADAPTIVE_MIN_INTERVAL_MS,
  DEFAULT_WATCHDOG_HEARTBEAT_INTERVAL_MS,
  type AdaptiveAdjustmentReason,
  type AdaptiveTimerConfig,
  type AdaptiveTimerState,
  type IntervalAdjustmentResult,
} from "./types.ts";

function resolveTimestampMs(now?: string | number | Date): number {
  if (typeof now === "number") return now;
  if (now instanceof Date) return now.getTime();
  if (typeof now === "string") {
    const parsed = Date.parse(now);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

type AdaptiveConfigInput = Partial<AdaptiveTimerConfig> & {
  readonly heartbeatIntervalMs?: number;
  readonly adaptive?: boolean | Partial<AdaptiveTimerConfig>;
  readonly initialStartedAt?: number | string | Date;
};

export class AdaptiveTimerController {
  private adaptiveEnabled: boolean;
  private minIntervalMsState: number;
  private maxIntervalMsState: number;
  private backoffFactorState: number;
  private activityBoostState: number;
  private currentIntervalMsState: number;
  private lastAdjustmentReasonState: AdaptiveAdjustmentReason = "initial";
  private lastAdjustedAtState: string;

  public constructor(config: AdaptiveConfigInput = {}, initialStartedAt?: number | string | Date) {
    const startedMs = resolveTimestampMs(initialStartedAt ?? config.initialStartedAt);
    this.lastAdjustedAtState = new Date(startedMs).toISOString();
    const nested =
      typeof config.adaptive === "object" && config.adaptive !== null ? config.adaptive : undefined;
    this.adaptiveEnabled =
      config.enabled !== undefined
        ? config.enabled
        : typeof config.adaptive === "boolean"
          ? config.adaptive
          : (nested?.enabled ?? true);
    const heartbeatMs = config.heartbeatIntervalMs ?? DEFAULT_WATCHDOG_HEARTBEAT_INTERVAL_MS;
    const minBound =
      nested?.minIntervalMs ?? config.minIntervalMs ?? DEFAULT_ADAPTIVE_MIN_INTERVAL_MS;
    const maxBound =
      nested?.maxIntervalMs ??
      config.maxIntervalMs ??
      Math.max(DEFAULT_ADAPTIVE_MAX_INTERVAL_MS, heartbeatMs);
    this.minIntervalMsState = Math.min(minBound, maxBound);
    this.maxIntervalMsState = Math.max(minBound, maxBound);
    this.backoffFactorState =
      nested?.backoffFactor ?? config.backoffFactor ?? DEFAULT_ADAPTIVE_BACKOFF_FACTOR;
    this.activityBoostState =
      nested?.activityBoost ?? config.activityBoost ?? DEFAULT_ADAPTIVE_ACTIVITY_BOOST;
    const initial =
      nested?.initialIntervalMs ??
      config.initialIntervalMs ??
      config.heartbeatIntervalMs ??
      DEFAULT_WATCHDOG_HEARTBEAT_INTERVAL_MS;
    this.currentIntervalMsState = Math.min(
      Math.max(initial, this.minIntervalMsState),
      this.maxIntervalMsState,
    );
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
    if (config.enabled !== undefined) this.adaptiveEnabled = config.enabled;
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
    const target =
      config.initialIntervalMs !== undefined && Number.isFinite(config.initialIntervalMs)
        ? config.initialIntervalMs
        : this.currentIntervalMsState;
    this.currentIntervalMsState = Math.min(
      Math.max(target, this.minIntervalMsState),
      this.maxIntervalMsState,
    );
  }

  public setAdaptiveBounds(bounds: Partial<AdaptiveTimerConfig>): void {
    this.configureAdaptiveTimers(bounds);
  }

  private applyAdjustment(
    targetIntervalMs: number,
    reason: AdaptiveAdjustmentReason,
    now?: string | number | Date,
  ): IntervalAdjustmentResult {
    const previousIntervalMs = this.currentIntervalMsState;
    const newIntervalMs = this.adaptiveEnabled ? targetIntervalMs : previousIntervalMs;
    const changed = this.adaptiveEnabled && newIntervalMs !== previousIntervalMs;
    if (changed) {
      this.currentIntervalMsState = newIntervalMs;
      this.lastAdjustmentReasonState = reason;
      this.lastAdjustedAtState = new Date(resolveTimestampMs(now)).toISOString();
    }
    return { previousIntervalMs, newIntervalMs, changed, state: this.getAdaptiveState(), reason };
  }

  public boostActivity(
    multiplier?: number,
    now?: string | number | Date,
    reason: AdaptiveAdjustmentReason = "activity_burst",
  ): IntervalAdjustmentResult {
    const factor =
      multiplier !== undefined && Number.isFinite(multiplier) && multiplier > 0
        ? multiplier
        : this.activityBoostState;
    const target = Math.max(
      this.minIntervalMsState,
      Math.round(this.currentIntervalMsState * factor),
    );
    return this.applyAdjustment(target, reason, now);
  }

  public decayIdle(
    multiplier?: number,
    now?: string | number | Date,
    reason: AdaptiveAdjustmentReason = "idle_backoff",
  ): IntervalAdjustmentResult {
    const factor =
      multiplier !== undefined && Number.isFinite(multiplier) && multiplier > 1
        ? multiplier
        : this.backoffFactorState;
    const target = Math.min(
      this.maxIntervalMsState,
      Math.round(this.currentIntervalMsState * factor),
    );
    return this.applyAdjustment(target, reason, now);
  }

  public resetInterval(
    defaultIntervalMs: number,
    intervalMs?: number,
    now?: string | number | Date,
  ): IntervalAdjustmentResult {
    const target = Math.min(
      Math.max(intervalMs ?? defaultIntervalMs, this.minIntervalMsState),
      this.maxIntervalMsState,
    );
    const previousIntervalMs = this.currentIntervalMsState;
    const changed = target !== previousIntervalMs;
    if (changed) {
      this.currentIntervalMsState = target;
      this.lastAdjustmentReasonState = "manual_reset";
      this.lastAdjustedAtState = new Date(resolveTimestampMs(now)).toISOString();
    }
    return {
      previousIntervalMs,
      newIntervalMs: target,
      changed,
      state: this.getAdaptiveState(),
      reason: "manual_reset",
    };
  }
}
