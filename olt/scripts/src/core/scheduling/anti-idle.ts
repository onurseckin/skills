import { applyIntervalJitter } from "./jitter.ts";
import { calculateExponentialBackoff } from "./backoff.ts";
import {
  DEFAULT_BASE_INTERVAL_MS,
  DEFAULT_MAX_INTERVAL_MS,
  DEFAULT_MAX_PAUSE_INTERVAL_MS,
  DEFAULT_JITTER_RATIO,
  QUIESCENCE_INTERVAL_MULTIPLIER,
  type AntiIdleIntervalOptions,
  type AntiIdleIntervalResult,
} from "./types.ts";

export function computeAntiIdleInterval(options: AntiIdleIntervalOptions): AntiIdleIntervalResult {
  const {
    hasPendingWork = false,
    active = false,
    zeroValueStreak = 0,
    retryAfterMs,
    baseIntervalMs = DEFAULT_BASE_INTERVAL_MS,
    maxIntervalMs = DEFAULT_MAX_INTERVAL_MS,
    maxPauseIntervalMs = DEFAULT_MAX_PAUSE_INTERVAL_MS,
    isRateLimited = false,
    previousIntervalMs,
    applyJitter = true,
    random = Math.random,
    jitterRatio = DEFAULT_JITTER_RATIO,
    multiplier = QUIESCENCE_INTERVAL_MULTIPLIER,
  } = options;

  if (hasPendingWork || active) {
    return {
      intervalMs: 0,
      rawIntervalMs: 0,
      isImmediate: true,
      reason: "Immediate rollover: active work or feedback present in queue",
      zeroValueStreak: 0,
    };
  }

  if (retryAfterMs !== undefined && retryAfterMs > 0) {
    const raw = retryAfterMs;
    const finalInterval = applyJitter
      ? applyIntervalJitter(raw, { jitterRatio, random, maxIntervalMs })
      : raw;
    return {
      intervalMs: finalInterval,
      rawIntervalMs: raw,
      isImmediate: false,
      reason: `Retry-After backoff: wait ${finalInterval}ms`,
      zeroValueStreak: zeroValueStreak + 1,
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

  const rawBackoff = calculateExponentialBackoff(
    baseIntervalMs,
    maxIntervalMs,
    zeroValueStreak,
    multiplier,
  );
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
