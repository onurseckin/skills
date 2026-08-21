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

export const MIN_JITTER_RATIO = 0.10; // 10%
export const MAX_JITTER_RATIO = 0.20; // 20%
export const DEFAULT_JITTER_RATIO = 0.15; // 15%
export const MIN_INTERVAL_MS = 1_000; // 1 second

export interface JitterOptions {
  readonly jitterRatio?: number | undefined;
  readonly minRatio?: number | undefined;
  readonly maxRatio?: number | undefined;
  readonly random?: (() => number) | undefined;
  readonly minIntervalMs?: number | undefined;
  readonly maxIntervalMs?: number | undefined;
}

/**
 * Applies bounded random jitter (+/- 10-20%) to an interval in milliseconds.
 * Prevents thundering herd across distributed autonomous workers.
 */
export function applyIntervalJitter(
  rawIntervalMs: number,
  options: JitterOptions = {},
): number {
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
  const meanValue =
    rawValues.length > 0 ? Number((totalValue / rawValues.length).toFixed(2)) : 0;

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
