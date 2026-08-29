import {
  DEFAULT_ADAPTIVE_ACTIVITY_BOOST,
  DEFAULT_ADAPTIVE_BACKOFF_FACTOR,
  DEFAULT_ADAPTIVE_MAX_INTERVAL_MS,
  DEFAULT_ADAPTIVE_MIN_INTERVAL_MS,
  DEFAULT_WATCHDOG_HEARTBEAT_INTERVAL_MS,
} from "../constants.ts";
import type {
  AdaptiveAdjustmentReason,
  AdaptiveTimerConfig,
  AdaptiveTimerState,
  AutonomicWatchdogConfig,
} from "./types.ts";

export interface IntervalAdjustmentResult {
  readonly previousIntervalMs: number;
  readonly newIntervalMs: number;
  readonly changed: boolean;
  readonly state: AdaptiveTimerState;
  readonly reason: AdaptiveAdjustmentReason;
}

function resolveTimestampMs(now?: string | number | Date): number {
  const timeMs =
    typeof now === "number"
      ? now
      : now instanceof Date
        ? now.getTime()
        : typeof now === "string"
          ? Date.parse(now)
          : Date.now();
  return Number.isFinite(timeMs) ? timeMs : Date.now();
}

export class AdaptiveTimerController {
  private adaptiveEnabled: boolean;
  private minIntervalMsState: number;
  private maxIntervalMsState: number;
  private backoffFactorState: number;
  private activityBoostState: number;
  private currentIntervalMsState: number;
  private lastAdjustmentReasonState: AdaptiveAdjustmentReason = "initial";
  private lastAdjustedAtState: string;

  public constructor(config: AutonomicWatchdogConfig = {}, initialStartedAtMs: number) {
    this.lastAdjustedAtState = new Date(initialStartedAtMs).toISOString();

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

    const heartbeatMs = config.heartbeatIntervalMs ?? DEFAULT_WATCHDOG_HEARTBEAT_INTERVAL_MS;
    const minBound =
      adaptiveConfig?.minIntervalMs ?? config.minIntervalMs ?? DEFAULT_ADAPTIVE_MIN_INTERVAL_MS;
    const maxBound =
      adaptiveConfig?.maxIntervalMs ??
      config.maxIntervalMs ??
      Math.max(DEFAULT_ADAPTIVE_MAX_INTERVAL_MS, heartbeatMs);

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
  ): IntervalAdjustmentResult {
    if (!this.adaptiveEnabled) {
      return {
        previousIntervalMs: this.currentIntervalMsState,
        newIntervalMs: this.currentIntervalMsState,
        changed: false,
        state: this.getAdaptiveState(),
        reason,
      };
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

    const changed = newIntervalMs !== previousIntervalMs;
    if (changed) {
      this.currentIntervalMsState = newIntervalMs;
      this.lastAdjustmentReasonState = reason;
      const resolvedMs = resolveTimestampMs(now);
      this.lastAdjustedAtState = new Date(resolvedMs).toISOString();
    }

    return {
      previousIntervalMs,
      newIntervalMs,
      changed,
      state: this.getAdaptiveState(),
      reason,
    };
  }

  public decayIdle(
    multiplier?: number,
    now?: string | number | Date,
    reason: AdaptiveAdjustmentReason = "idle_backoff",
  ): IntervalAdjustmentResult {
    if (!this.adaptiveEnabled) {
      return {
        previousIntervalMs: this.currentIntervalMsState,
        newIntervalMs: this.currentIntervalMsState,
        changed: false,
        state: this.getAdaptiveState(),
        reason,
      };
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

    const changed = newIntervalMs !== previousIntervalMs;
    if (changed) {
      this.currentIntervalMsState = newIntervalMs;
      this.lastAdjustmentReasonState = reason;
      const resolvedMs = resolveTimestampMs(now);
      this.lastAdjustedAtState = new Date(resolvedMs).toISOString();
    }

    return {
      previousIntervalMs,
      newIntervalMs,
      changed,
      state: this.getAdaptiveState(),
      reason,
    };
  }

  public resetInterval(
    defaultIntervalMs: number,
    intervalMs?: number,
    now?: string | number | Date,
  ): IntervalAdjustmentResult {
    const target = intervalMs ?? defaultIntervalMs;
    const previousIntervalMs = this.currentIntervalMsState;
    const newIntervalMs = Math.min(
      Math.max(target, this.minIntervalMsState),
      this.maxIntervalMsState,
    );

    const changed = newIntervalMs !== previousIntervalMs;
    if (changed) {
      this.currentIntervalMsState = newIntervalMs;
      this.lastAdjustmentReasonState = "manual_reset";
      const resolvedMs = resolveTimestampMs(now);
      this.lastAdjustedAtState = new Date(resolvedMs).toISOString();
    }

    return {
      previousIntervalMs,
      newIntervalMs,
      changed,
      state: this.getAdaptiveState(),
      reason: "manual_reset",
    };
  }
}
