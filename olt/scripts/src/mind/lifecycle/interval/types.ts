import { HarnessError } from "../../../core/errors/index.ts";

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

export const DEFAULT_BASE_INTERVAL_MS = 900_000;

// 15 minutes
export const DEFAULT_MAX_INTERVAL_MS = 14_400_000;

// 4 hours
export const DEFAULT_MAX_PAUSE_INTERVAL_MS = 1_800_000;

// 30 minutes
export const QUIESCENCE_INTERVAL_MULTIPLIER = 1.5;

export const MIN_JITTER_RATIO = 0.1;

// 10%
export const MAX_JITTER_RATIO = 0.2;

// 20%
export const DEFAULT_JITTER_RATIO = 0.15;

// 15%
export const MIN_INTERVAL_MS = 1_000;

// 1 second

export type BackoffStrategy = "exponential" | "linear" | "fibonacci" | "fixed" | "immediate";

export interface JitterOptions {
  readonly jitterRatio?: number | undefined;
  readonly minRatio?: number | undefined;
  readonly maxRatio?: number | undefined;
  readonly random?: (() => number) | undefined;
  readonly minIntervalMs?: number | undefined;
  readonly maxIntervalMs?: number | undefined;
}

/**
 * Creates a deterministic pseudo-random number generator (Mulberry32) from a 32-bit integer seed.
 * Produces uniform float values in [0, 1) for reproducible jitter calculations.
 */
export function createDeterministicRandom(seed: number): () => number {
  let s = Math.trunc(seed) >>> 0;
  return function mulberry32(): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Applies bounded random jitter (+/- 10-20%) to an interval in milliseconds.
 * Prevents thundering herd across distributed autonomous workers.
 */
export function applyIntervalJitter(rawIntervalMs: number, options: JitterOptions = {}): number {
  if (rawIntervalMs <= 0) return Math.max(0, rawIntervalMs);

  const randomFn = options.random ?? Math.random;
  const targetRatio = options.jitterRatio ?? DEFAULT_JITTER_RATIO;
  const minRatio = options.minRatio ?? MIN_JITTER_RATIO;
  const maxRatio = options.maxRatio ?? MAX_JITTER_RATIO;

  // Clamp jitter ratio within [minRatio, maxRatio]
  const clampedRatio = Math.max(minRatio, Math.min(maxRatio, targetRatio));

  const r = randomFn();
  // Map r in [0, 1) to factor in [-clampedRatio, +clampedRatio]
  const factor = (r * 2 - 1) * clampedRatio;
  const jittered = Math.round(rawIntervalMs * (1 + factor));

  const minLimit = options.minIntervalMs ?? MIN_INTERVAL_MS;
  const maxLimit = options.maxIntervalMs ?? DEFAULT_MAX_INTERVAL_MS;

  return Math.max(minLimit, Math.min(maxLimit, jittered));
}

/**
 * Computes deterministic interval with seed-based jitter for reproducible tests and schedules.
 */
export function calculateDeterministicInterval(
  rawIntervalMs: number,
  seed: number,
  options: Omit<JitterOptions, "random"> = {},
): number {
  const prng = createDeterministicRandom(seed);
  return applyIntervalJitter(rawIntervalMs, {
    ...options,
    random: prng,
  });
}

/**
 * Computes exponential backoff interval: min(maxIntervalMs, round(baseIntervalMs * 1.5^streak))
 */
export function calculateExponentialBackoff(
  baseIntervalMs: number,
  maxIntervalMs: number,
  streak: number,
): number {
  const safeStreak = Math.max(0, streak);
  return Math.min(
    maxIntervalMs,
    Math.round(baseIntervalMs * Math.pow(QUIESCENCE_INTERVAL_MULTIPLIER, safeStreak)),
  );
}

/**
 * Computes backoff interval supporting multiple configurable strategies:
 * - exponential: base * multiplier^streak
 * - linear: base * (1 + streak)
 * - fibonacci: base * fib(streak + 1)
 * - fixed: base
 * - immediate: 0
 */
export function calculateBackoffWithStrategy(options: {
  readonly baseIntervalMs: number;
  readonly maxIntervalMs: number;
  readonly streak: number;
  readonly strategy?: BackoffStrategy | undefined;
  readonly multiplier?: number | undefined;
}): number {
  const {
    baseIntervalMs,
    maxIntervalMs,
    streak,
    strategy = "exponential",
    multiplier = QUIESCENCE_INTERVAL_MULTIPLIER,
  } = options;

  const safeStreak = Math.max(0, streak);

  switch (strategy) {
    case "immediate":
      return 0;

    case "fixed":
      return Math.min(maxIntervalMs, baseIntervalMs);

    case "linear": {
      const raw = baseIntervalMs * (1 + safeStreak);
      return Math.min(maxIntervalMs, Math.round(raw));
    }

    case "fibonacci": {
      let a = 1;
      let b = 1;
      for (let i = 0; i < safeStreak; i++) {
        const next = a + b;
        a = b;
        b = next;
      }
      const raw = baseIntervalMs * a;
      return Math.min(maxIntervalMs, Math.round(raw));
    }

    case "exponential":
    default: {
      const raw = baseIntervalMs * Math.pow(multiplier, safeStreak);
      return Math.min(maxIntervalMs, Math.round(raw));
    }
  }
}

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

/**
 * Calculates next wake interval with jittered exponential backoff throttle per PLAN §11.2 and PHASE-5 §3.3:
 * - When value > 0: resets to base_interval, streak resets to 0.
 * - When value == 0 for K consecutive pulses: computes min(max_interval, base_interval * 1.5^K)
 *   with mandatory random jitter (+/- 10-20% bounded) to prevent thundering herd.
 * - Terminal outcomes (halted, unarmed): returns intervalMs = null.
 * - Rate limit / paused: doubles previous interval up to maxPauseIntervalMs.
 */
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
