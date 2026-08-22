import { HarnessError } from "../errors/harness-error.ts";
import {
  calculatePulseValue,
  isPulseOutcome,
  isTerminalOutcome,
  parseDuration,
  PULSE_OUTCOMES,
  type PulseOutcome,
  type PulseValueMetrics,
} from "./value.ts";

export const DEFAULT_BASE_INTERVAL_MS = 900_000; // 15 minutes
export const DEFAULT_MAX_INTERVAL_MS = 14_400_000; // 4 hours
export const DEFAULT_MAX_PAUSE_INTERVAL_MS = 1_800_000; // 30 minutes
export const QUIESCENCE_INTERVAL_MULTIPLIER = 1.5;

export const MIN_JITTER_RATIO = 0.1; // 10%
export const MAX_JITTER_RATIO = 0.2; // 20%
export const DEFAULT_JITTER_RATIO = 0.15; // 15%
export const MIN_INTERVAL_MS = 1_000; // 1 second

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

export interface AntiIdleIntervalOptions {
  readonly hasPendingWork: boolean;
  readonly zeroValueStreak: number;
  readonly baseIntervalMs?: number | undefined;
  readonly maxIntervalMs?: number | undefined;
  readonly maxPauseIntervalMs?: number | undefined;
  readonly isRateLimited?: boolean | undefined;
  readonly previousIntervalMs?: number | undefined;
  readonly applyJitter?: boolean | undefined;
  readonly random?: (() => number) | undefined;
  readonly jitterRatio?: number | undefined;
}

export interface AntiIdleIntervalResult {
  readonly intervalMs: number;
  readonly rawIntervalMs: number;
  readonly isImmediate: boolean;
  readonly reason: string;
  readonly zeroValueStreak: number;
}

/**
 * Computes interval taking anti-idle immediate rollover into account.
 * When work is pending (hasPendingWork = true), immediately returns intervalMs = 0 (isImmediate = true).
 * Otherwise applies standard exponential backoff with optional jitter.
 */
export function computeAntiIdleInterval(
  options: AntiIdleIntervalOptions,
): AntiIdleIntervalResult {
  const {
    hasPendingWork,
    zeroValueStreak,
    baseIntervalMs = DEFAULT_BASE_INTERVAL_MS,
    maxIntervalMs = DEFAULT_MAX_INTERVAL_MS,
    maxPauseIntervalMs = DEFAULT_MAX_PAUSE_INTERVAL_MS,
    isRateLimited = false,
    previousIntervalMs,
    applyJitter = true,
    random = Math.random,
    jitterRatio = DEFAULT_JITTER_RATIO,
  } = options;

  if (hasPendingWork) {
    return {
      intervalMs: 0,
      rawIntervalMs: 0,
      isImmediate: true,
      reason: "Immediate rollover: active work or feedback present in queue",
      zeroValueStreak: 0,
    };
  }

  if (isRateLimited) {
    const prev =
      previousIntervalMs !== undefined && previousIntervalMs > 0
        ? previousIntervalMs
        : baseIntervalMs;
    const raw = Math.min(maxPauseIntervalMs, prev * 2);
    const jittered = applyJitter
      ? applyIntervalJitter(raw, { jitterRatio, random, maxIntervalMs: maxPauseIntervalMs })
      : raw;
    return {
      intervalMs: jittered,
      rawIntervalMs: raw,
      isImmediate: false,
      reason: `Rate limit backoff: paused interval ${jittered}ms`,
      zeroValueStreak: zeroValueStreak + 1,
    };
  }

  const rawBackoff = calculateExponentialBackoff(baseIntervalMs, maxIntervalMs, zeroValueStreak);
  const finalInterval = applyJitter
    ? applyIntervalJitter(rawBackoff, { jitterRatio, random, maxIntervalMs })
    : rawBackoff;

  return {
    intervalMs: finalInterval,
    rawIntervalMs: rawBackoff,
    isImmediate: false,
    reason: `Quiescent backoff: streak ${zeroValueStreak}, interval ${finalInterval}ms`,
    zeroValueStreak,
  };
}

/**
 * Projects backoff interval progression over N steps.
 */
export function projectIntervalProgression(options: {
  readonly baseIntervalMs: number;
  readonly maxIntervalMs: number;
  readonly steps: number;
  readonly multiplier?: number | undefined;
  readonly strategy?: BackoffStrategy | undefined;
}): readonly number[] {
  const { baseIntervalMs, maxIntervalMs, steps, multiplier, strategy } = options;
  const safeSteps = Math.max(0, steps);
  const progression: number[] = [];

  for (let streak = 0; streak < safeSteps; streak++) {
    progression.push(
      calculateBackoffWithStrategy({
        baseIntervalMs,
        maxIntervalMs,
        streak,
        strategy,
        multiplier,
      }),
    );
  }

  return progression;
}

/**
 * Formats a duration in milliseconds to human-readable string (e.g., "0ms", "500ms", "15m", "1h 30m").
 */
export function formatIntervalDuration(intervalMs: number): string {
  if (intervalMs <= 0) return "0ms";
  if (intervalMs < 1000) return `${intervalMs}ms`;

  const totalSeconds = Math.floor(intervalMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 && hours === 0) parts.push(`${seconds}s`);

  return parts.length > 0 ? parts.join(" ") : "0s";
}

/**
 * Parses duration string into milliseconds (e.g., "0ms" -> 0, "15m" -> 900000, "4h" -> 14400000).
 */
export function parseIntervalDuration(durationStr: string): number {
  const trimmed = durationStr.trim().toLowerCase();
  if (trimmed === "0" || trimmed === "0ms" || trimmed === "0s" || trimmed === "0m") return 0;
  return parseDuration(durationStr);
}

export interface TrailingValuePoint {
  readonly pulseId: string;
  readonly pulseNumber?: number | undefined;
  readonly outcome: string;
  readonly value: number;
  readonly timestamp?: string | undefined;
  readonly metrics?: PulseValueMetrics | undefined;
}

export interface TrailingValueSeries {
  readonly points: readonly TrailingValuePoint[];
  readonly rawValues: readonly number[];
  readonly totalValue: number;
  readonly meanValue: number;
  readonly trailingZeroStreak: number;
  readonly isFlatZero: boolean;
  readonly windowSize: number;
  readonly formattedSeries: string;
  readonly markdown: string;
}

/**
 * Generates trailing value series from recorded pulse points.
 * Ensures the owner digest can render raw unmasked series rather than hiding zeroes behind summaries.
 */
export function generateTrailingValueSeries(
  pulses: readonly TrailingValuePoint[],
  windowSize: number = 20,
): TrailingValueSeries {
  const windowedPoints = windowSize > 0 ? pulses.slice(-windowSize) : pulses;
  const rawValues = windowedPoints.map((p) => p.value);
  const totalValue = rawValues.reduce((sum, v) => sum + v, 0);
  const meanValue = rawValues.length > 0 ? Number((totalValue / rawValues.length).toFixed(2)) : 0;

  let trailingZeroStreak = 0;
  for (let i = rawValues.length - 1; i >= 0; i--) {
    if (rawValues[i] === 0) {
      trailingZeroStreak++;
    } else {
      break;
    }
  }

  const isFlatZero = rawValues.length > 0 && rawValues.every((v) => v === 0);
  const formattedSeries = `[${rawValues.join(", ")}]`;

  const markdownLines = [
    `### Trailing Value Series (Last ${rawValues.length} Pulses)`,
    `- **Raw Series**: \`${formattedSeries}\``,
    `- **Total Value**: ${totalValue}`,
    `- **Trailing Zero Streak**: ${trailingZeroStreak}`,
  ];

  if (isFlatZero && rawValues.length >= 5) {
    markdownLines.push(
      `> ⚠️ **Flat Zero Series**: All ${rawValues.length} recent pulses produced 0 value. A long flat zero is either a healthy repository or a broken mind, and only a human can tell which.`,
    );
  }

  return {
    points: windowedPoints,
    rawValues,
    totalValue,
    meanValue,
    trailingZeroStreak,
    isFlatZero,
    windowSize: rawValues.length,
    formattedSeries,
    markdown: markdownLines.join("\n"),
  };
}

/**
 * Extracts trailing value series from capsule state object.
 */
export function extractTrailingValueSeriesFromState(
  state: Record<string, unknown>,
  windowSize: number = 20,
): TrailingValueSeries {
  const points: TrailingValuePoint[] = [];

  const pulseObj =
    typeof state.pulse === "object" && state.pulse !== null
      ? (state.pulse as Record<string, unknown>)
      : {};

  if (Array.isArray(pulseObj.history)) {
    for (const item of pulseObj.history) {
      if (typeof item === "object" && item !== null) {
        const hist = item as Record<string, unknown>;
        const pid =
          typeof hist.pulse_id === "string"
            ? hist.pulse_id
            : typeof hist.id === "string"
              ? hist.id
              : "pulse";
        const val = typeof hist.value === "number" ? hist.value : 0;
        const outcome = typeof hist.outcome === "string" ? hist.outcome : "quiescent";
        const timestamp =
          typeof hist.closed_at === "string"
            ? hist.closed_at
            : typeof hist.at === "string"
              ? hist.at
              : undefined;
        points.push({
          pulseId: pid,
          outcome,
          value: val,
          timestamp,
        });
      }
    }
  } else if (typeof pulseObj.last === "object" && pulseObj.last !== null) {
    const last = pulseObj.last as Record<string, unknown>;
    const pid = typeof last.pulse_id === "string" ? last.pulse_id : "pulse-last";
    const val = typeof last.value === "number" ? last.value : 0;
    const outcome = typeof last.outcome === "string" ? last.outcome : "quiescent";
    const timestamp = typeof last.closed_at === "string" ? last.closed_at : undefined;
    points.push({
      pulseId: pid,
      outcome,
      value: val,
      timestamp,
    });
  }

  return generateTrailingValueSeries(points, windowSize);
}

/**
 * Extracts trailing value series from capsule event stream.
 */
export function extractTrailingValueSeriesFromEvents(
  events: readonly Record<string, unknown>[],
  windowSize: number = 20,
): TrailingValueSeries {
  const points: TrailingValuePoint[] = [];

  for (const ev of events) {
    if (ev.kind === "mind-pulse-closed") {
      const payload =
        typeof ev.payload === "object" && ev.payload !== null
          ? (ev.payload as Record<string, unknown>)
          : {};
      const pid = typeof payload.pulse_id === "string" ? payload.pulse_id : "pulse";
      const val = typeof payload.value === "number" ? payload.value : 0;
      const outcome = typeof payload.outcome === "string" ? payload.outcome : "quiescent";
      const timestamp = typeof ev.timestamp === "string" ? ev.timestamp : undefined;

      points.push({
        pulseId: pid,
        outcome,
        value: val,
        timestamp,
      });
    }
  }

  return generateTrailingValueSeries(points, windowSize);
}

/**
 * Formats a raw number array into `[0, 1, 2, ...]` string.
 */
export function formatRawValueSeries(values: readonly number[]): string {
  return `[${values.join(", ")}]`;
}
