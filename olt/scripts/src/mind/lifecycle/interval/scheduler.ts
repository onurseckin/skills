import { HarnessError } from "../../../core/errors/index.ts";
import {
  DEFAULT_BASE_INTERVAL_MS,
  DEFAULT_MAX_INTERVAL_MS,
  DEFAULT_MAX_PAUSE_INTERVAL_MS,
  DEFAULT_JITTER_RATIO,
  applyIntervalJitter,
  calculateBackoffWithStrategy,
  calculateExponentialBackoff,
  type BackoffStrategy,
} from "./types.ts";

export interface PulseValueMetrics {
  readonly [key: string]: unknown;
}

export function parseDuration(duration: number | string): number {
  if (typeof duration === "number") {
    if (duration < 0 || Number.isNaN(duration)) {
      throw new HarnessError("INVALID_ARGUMENT", "duration must be non-negative");
    }
    return duration;
  }
  if (typeof duration !== "string" || duration.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "duration string cannot be empty");
  }
  const match = duration.trim().match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/);
  if (!match) {
    throw new HarnessError("INVALID_ARGUMENT", `invalid duration format: ${duration}`);
  }
  const num = parseFloat(match[1]!);
  const unit = match[2] ?? "ms";
  switch (unit) {
    case "s":
      return num * 1000;
    case "m":
      return num * 60 * 1000;
    case "h":
      return num * 60 * 60 * 1000;
    case "d":
      return num * 24 * 60 * 60 * 1000;
    default:
      return num;
  }
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
export function computeAntiIdleInterval(options: AntiIdleIntervalOptions): AntiIdleIntervalResult {
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

export {
  generateTrailingValueSeries,
  extractTrailingValueSeriesFromState,
  type TrailingValuePoint,
  type TrailingValueSeries,
} from "./state.ts";
