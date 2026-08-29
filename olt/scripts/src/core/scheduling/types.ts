export const DEFAULT_BASE_INTERVAL_MS = 900_000;
export const DEFAULT_MAX_INTERVAL_MS = 14_400_000;
export const DEFAULT_MAX_PAUSE_INTERVAL_MS = 1_800_000;
export const QUIESCENCE_INTERVAL_MULTIPLIER = 1.5;
export const MIN_JITTER_RATIO = 0.1;
export const MAX_JITTER_RATIO = 0.2;
export const DEFAULT_JITTER_RATIO = 0.15;
export const MIN_INTERVAL_MS = 1_000;
export const DEFAULT_ADAPTIVE_MIN_INTERVAL_MS = 15_000;
export const DEFAULT_ADAPTIVE_MAX_INTERVAL_MS = 900_000;
export const DEFAULT_ADAPTIVE_BACKOFF_FACTOR = 1.5;
export const DEFAULT_ADAPTIVE_ACTIVITY_BOOST = 0.5;
export const DEFAULT_WATCHDOG_HEARTBEAT_INTERVAL_MS = 180_000;

export type BackoffStrategy = "exponential" | "linear" | "fibonacci" | "fixed" | "immediate";

export interface JitterOptions {
  readonly jitterRatio?: number | undefined;
  readonly minRatio?: number | undefined;
  readonly maxRatio?: number | undefined;
  readonly random?: (() => number) | undefined;
  readonly minIntervalMs?: number | undefined;
  readonly maxIntervalMs?: number | undefined;
}

export interface CompositeSeedOptions {
  readonly agentId?: string | undefined;
  readonly role?: string | undefined;
  readonly taskId?: string | null | undefined;
  readonly salt?: string | number | undefined;
  readonly iteration?: number | undefined;
  readonly timestamp?: number | string | Date | undefined;
}

export interface BackoffStrategyOptions {
  readonly baseIntervalMs: number;
  readonly maxIntervalMs: number;
  readonly streak: number;
  readonly strategy?: BackoffStrategy | undefined;
  readonly multiplier?: number | undefined;
}

export type AdaptiveAdjustmentReason =
  | "initial"
  | "activity_burst"
  | "idle_backoff"
  | "manual_reset"
  | "event_wakeup";

export interface AdaptiveTimerConfig {
  readonly enabled?: boolean | undefined;
  readonly minIntervalMs?: number | undefined;
  readonly maxIntervalMs?: number | undefined;
  readonly backoffFactor?: number | undefined;
  readonly activityBoost?: number | undefined;
  readonly initialIntervalMs?: number | undefined;
}

export interface AdaptiveTimerState {
  readonly enabled: boolean;
  readonly currentIntervalMs: number;
  readonly minIntervalMs: number;
  readonly maxIntervalMs: number;
  readonly backoffFactor: number;
  readonly activityBoost: number;
  readonly lastAdjustmentReason: AdaptiveAdjustmentReason;
  readonly lastAdjustedAt: string;
}

export interface IntervalAdjustmentResult {
  readonly previousIntervalMs: number;
  readonly newIntervalMs: number;
  readonly changed: boolean;
  readonly state: AdaptiveTimerState;
  readonly reason: AdaptiveAdjustmentReason;
}

export interface AntiIdleIntervalOptions {
  readonly hasPendingWork?: boolean | undefined;
  readonly active?: boolean | undefined;
  readonly zeroValueStreak?: number | undefined;
  readonly retryAfterMs?: number | undefined;
  readonly baseIntervalMs?: number | undefined;
  readonly maxIntervalMs?: number | undefined;
  readonly maxPauseIntervalMs?: number | undefined;
  readonly isRateLimited?: boolean | undefined;
  readonly previousIntervalMs?: number | undefined;
  readonly applyJitter?: boolean | undefined;
  readonly random?: (() => number) | undefined;
  readonly jitterRatio?: number | undefined;
  readonly multiplier?: number | undefined;
}

export interface AntiIdleIntervalResult {
  readonly intervalMs: number;
  readonly rawIntervalMs: number;
  readonly isImmediate: boolean;
  readonly reason: string;
  readonly zeroValueStreak: number;
}
