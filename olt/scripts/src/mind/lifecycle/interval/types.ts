import {
  DEFAULT_BASE_INTERVAL_MS,
  DEFAULT_MAX_INTERVAL_MS,
  DEFAULT_MAX_PAUSE_INTERVAL_MS,
  DEFAULT_JITTER_RATIO,
  MIN_INTERVAL_MS,
  MIN_JITTER_RATIO,
  MAX_JITTER_RATIO,
  QUIESCENCE_INTERVAL_MULTIPLIER,
  type BackoffStrategy,
  type JitterOptions,
  createDeterministicRandom,
  applyIntervalJitter,
  calculateDeterministicInterval,
  calculateExponentialBackoff,
  calculateBackoffWithStrategy,
} from "../../../core/scheduling/index.ts";

export const PULSE_OUTCOMES = [
  "advance_dispatched",
  "advance_quiescent",
  "repair_resolved",
  "repair_quiescent",
  "rescue_healed",
  "rescue_quiescent",
  "discover_synthesized",
  "discover_quiescent",
  "quiescent",
  "halted",
  "unarmed",
] as const;

export type PulseOutcome = (typeof PULSE_OUTCOMES)[number];

export const TERMINAL_OUTCOMES = ["halted", "unarmed"] as const;
export type TerminalOutcome = (typeof TERMINAL_OUTCOMES)[number];

export function isPulseOutcome(outcome: string): outcome is PulseOutcome {
  return (PULSE_OUTCOMES as readonly string[]).includes(outcome);
}

export function isTerminalOutcome(outcome: string): outcome is TerminalOutcome {
  return (TERMINAL_OUTCOMES as readonly string[]).includes(outcome);
}

export {
  DEFAULT_BASE_INTERVAL_MS,
  DEFAULT_MAX_INTERVAL_MS,
  DEFAULT_MAX_PAUSE_INTERVAL_MS,
  QUIESCENCE_INTERVAL_MULTIPLIER,
  MIN_JITTER_RATIO,
  MAX_JITTER_RATIO,
  DEFAULT_JITTER_RATIO,
  MIN_INTERVAL_MS,
  type BackoffStrategy,
  type JitterOptions,
  createDeterministicRandom,
  applyIntervalJitter,
  calculateDeterministicInterval,
  calculateExponentialBackoff,
  calculateBackoffWithStrategy,
};

export interface ThrottleIntervalOptions {
  readonly baseIntervalMs: number;
  readonly maxIntervalMs: number;
  readonly maxPauseIntervalMs?: number | undefined;
  readonly previousIntervalMs?: number | undefined;
  readonly zeroValueStreak: number;
  readonly value: number;
  readonly outcome?: PulseOutcome | string | undefined;
  readonly signal?: string | null | undefined;
  readonly applyJitter?: boolean | undefined;
  readonly random?: (() => number) | undefined;
  readonly jitterRatio?: number | undefined;
}

export interface ThrottleIntervalResult {
  readonly intervalMs: number | null;
  readonly rawIntervalMs: number | null;
  readonly zeroValueStreak: number;
  readonly isTerminal: boolean;
  readonly isReset: boolean;
  readonly isRateLimited: boolean;
}

export function calculateThrottleInterval(
  options: ThrottleIntervalOptions,
): ThrottleIntervalResult {
  const {
    baseIntervalMs,
    maxIntervalMs,
    maxPauseIntervalMs = DEFAULT_MAX_PAUSE_INTERVAL_MS,
    previousIntervalMs,
    zeroValueStreak,
    value,
    outcome,
    signal,
    applyJitter = true,
    random = Math.random,
    jitterRatio = DEFAULT_JITTER_RATIO,
  } = options;

  if (outcome !== undefined && isTerminalOutcome(outcome)) {
    return {
      intervalMs: null,
      rawIntervalMs: null,
      zeroValueStreak: 0,
      isTerminal: true,
      isReset: false,
      isRateLimited: false,
    };
  }

  const isRateLimited = signal === "rate_limit" || outcome === "paused";

  let nextStreak = zeroValueStreak;
  let rawInterval: number;
  let isReset = false;

  if (isRateLimited) {
    const prev =
      previousIntervalMs !== undefined && previousIntervalMs > 0
        ? previousIntervalMs
        : baseIntervalMs;
    rawInterval = Math.min(maxPauseIntervalMs, prev * 2);
    nextStreak = value > 0 ? 0 : zeroValueStreak + 1;
    isReset = false;
  } else if (value > 0) {
    nextStreak = 0;
    rawInterval = baseIntervalMs;
    isReset = true;
  } else {
    nextStreak = zeroValueStreak + 1;
    rawInterval = calculateExponentialBackoff(baseIntervalMs, maxIntervalMs, nextStreak);
    isReset = false;
  }

  let finalInterval = rawInterval;
  if (applyJitter && rawInterval > 0) {
    finalInterval = applyIntervalJitter(rawInterval, {
      jitterRatio,
      random,
      maxIntervalMs,
    });
  }

  return {
    intervalMs: finalInterval,
    rawIntervalMs: rawInterval,
    zeroValueStreak: nextStreak,
    isTerminal: false,
    isReset,
    isRateLimited,
  };
}
