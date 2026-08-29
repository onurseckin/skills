export type {
  BackoffStrategy,
  JitterOptions,
  PulseOutcome,
  TerminalOutcome,
  ThrottleIntervalOptions,
  ThrottleIntervalResult,
} from "./types.ts";

export {
  DEFAULT_BASE_INTERVAL_MS,
  DEFAULT_MAX_INTERVAL_MS,
  DEFAULT_MAX_PAUSE_INTERVAL_MS,
  QUIESCENCE_INTERVAL_MULTIPLIER,
  MIN_JITTER_RATIO,
  MAX_JITTER_RATIO,
  DEFAULT_JITTER_RATIO,
  MIN_INTERVAL_MS,
  PULSE_OUTCOMES,
  TERMINAL_OUTCOMES,
  isPulseOutcome,
  isTerminalOutcome,
  createDeterministicRandom,
  applyIntervalJitter,
  calculateDeterministicInterval,
  calculateExponentialBackoff,
  calculateBackoffWithStrategy,
  calculateThrottleInterval,
} from "./types.ts";

export type {
  AntiIdleIntervalOptions,
  AntiIdleIntervalResult,
  TrailingValuePoint,
  TrailingValueSeries,
} from "./scheduler.ts";

export {
  computeAntiIdleInterval,
  computeAntiIdleInterval as computeNextInterval,
  projectIntervalProgression,
  formatIntervalDuration,
  parseIntervalDuration,
  generateTrailingValueSeries,
  extractTrailingValueSeriesFromState,
} from "./scheduler.ts";

export { extractTrailingValueSeriesFromEvents, formatRawValueSeries } from "./state.ts";
