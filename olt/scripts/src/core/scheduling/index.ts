export type {
  AdaptiveAdjustmentReason,
  AdaptiveTimerConfig,
  AdaptiveTimerState,
  AntiIdleIntervalOptions,
  AntiIdleIntervalResult,
  BackoffStrategy,
  BackoffStrategyOptions,
  CompositeSeedOptions,
  IntervalAdjustmentResult,
  JitterOptions,
} from "./types.ts";
export {
  DEFAULT_ADAPTIVE_ACTIVITY_BOOST,
  DEFAULT_ADAPTIVE_BACKOFF_FACTOR,
  DEFAULT_ADAPTIVE_MAX_INTERVAL_MS,
  DEFAULT_ADAPTIVE_MIN_INTERVAL_MS,
  DEFAULT_BASE_INTERVAL_MS,
  DEFAULT_JITTER_RATIO,
  DEFAULT_MAX_INTERVAL_MS,
  DEFAULT_MAX_PAUSE_INTERVAL_MS,
  DEFAULT_WATCHDOG_HEARTBEAT_INTERVAL_MS,
  MAX_JITTER_RATIO,
  MIN_INTERVAL_MS,
  MIN_JITTER_RATIO,
  QUIESCENCE_INTERVAL_MULTIPLIER,
} from "./types.ts";
export {
  applyIntervalJitter,
  calculateDeterministicInterval,
  createCompositeSeed,
  createDeterministicRandom,
  fnv1a32,
} from "./jitter.ts";
export {
  calculateBackoffWithStrategy,
  calculateExponentialBackoff,
  projectIntervalProgression,
} from "./backoff.ts";
export { formatIntervalDuration, parseDuration, parseIntervalDuration } from "./duration.ts";
export { computeAntiIdleInterval } from "./anti-idle.ts";
export { AdaptiveTimerController } from "./adaptive-timer.ts";
export {
  generateTrailingValueSeries,
  extractTrailingValueSeriesFromState,
  extractTrailingValueSeriesFromEvents,
  formatRawValueSeries,
  type PulseValueMetrics,
  type TrailingValuePoint,
  type TrailingValueSeries,
} from "./trailing-series.ts";
