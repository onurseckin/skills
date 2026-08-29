import {
  applyIntervalJitter,
  calculateBackoffWithStrategy,
  calculateDeterministicInterval,
  computeAntiIdleInterval,
  type BackoffStrategy,
} from "../../core/scheduling/index.ts";
import { boolFlag, integerFlag, textFlag, type CommandContext, type Flags } from "../options.ts";

export function schedEvalCommand(flags: Flags, _context?: CommandContext): Record<string, unknown> {
  const hasPendingWork =
    flags["pending-work"] === true ||
    flags["has-pending-work"] === true ||
    boolFlag(flags, "pending-work") ||
    boolFlag(flags, "has-pending-work");
  const active = flags["active"] === true || boolFlag(flags, "active");
  const zeroValueStreak =
    integerFlag(flags, "streak") ?? integerFlag(flags, "zero-value-streak") ?? 0;
  const retryAfterMs = integerFlag(flags, "retry-after") ?? integerFlag(flags, "retry-after-ms");
  const baseIntervalMs =
    integerFlag(flags, "base-interval") ?? integerFlag(flags, "base-interval-ms");
  const maxIntervalMs = integerFlag(flags, "max-interval") ?? integerFlag(flags, "max-interval-ms");
  const maxPauseIntervalMs =
    integerFlag(flags, "max-pause-interval") ?? integerFlag(flags, "max-pause-interval-ms");
  const isRateLimited =
    flags["rate-limited"] === true ||
    flags["is-rate-limited"] === true ||
    boolFlag(flags, "rate-limited") ||
    boolFlag(flags, "is-rate-limited");
  const previousIntervalMs =
    integerFlag(flags, "previous-interval") ?? integerFlag(flags, "previous-interval-ms");
  const applyJitter =
    boolFlag(flags, "no-jitter") || flags["jitter"] === "false" || flags["apply-jitter"] === "false"
      ? false
      : true;
  const jitterRatioStr = textFlag(flags, "jitter-ratio", false);
  const jitterRatio = jitterRatioStr !== undefined ? Number(jitterRatioStr) : undefined;
  const multiplierStr = textFlag(flags, "multiplier", false);
  const multiplier = multiplierStr !== undefined ? Number(multiplierStr) : undefined;

  const result = computeAntiIdleInterval({
    hasPendingWork,
    active,
    zeroValueStreak,
    retryAfterMs,
    baseIntervalMs,
    maxIntervalMs,
    maxPauseIntervalMs,
    isRateLimited,
    previousIntervalMs,
    applyJitter,
    jitterRatio,
    multiplier,
  });

  return {
    intervalMs: result.intervalMs,
    rawIntervalMs: result.rawIntervalMs,
    isImmediate: result.isImmediate,
    reason: result.reason,
    zeroValueStreak: result.zeroValueStreak,
  };
}

export function schedBackoffCommand(
  flags: Flags,
  _context?: CommandContext,
): Record<string, unknown> {
  const baseIntervalMs =
    integerFlag(flags, "base-interval") ?? integerFlag(flags, "base-interval-ms") ?? 1000;
  const maxIntervalMs =
    integerFlag(flags, "max-interval") ?? integerFlag(flags, "max-interval-ms") ?? 30000;
  const streak = integerFlag(flags, "streak") ?? 0;
  const strategyFlag = textFlag(flags, "strategy", false);
  const strategy: BackoffStrategy =
    strategyFlag !== undefined ? (strategyFlag as BackoffStrategy) : "exponential";
  const multiplierStr = textFlag(flags, "multiplier", false);
  const multiplier = multiplierStr !== undefined ? Number(multiplierStr) : undefined;

  const delayMs = calculateBackoffWithStrategy({
    baseIntervalMs,
    maxIntervalMs,
    streak,
    strategy,
    multiplier,
  });

  return {
    delayMs,
    baseIntervalMs,
    maxIntervalMs,
    streak,
    strategy,
  };
}

export function schedJitterCommand(
  flags: Flags,
  _context?: CommandContext,
): Record<string, unknown> {
  const rawIntervalMs =
    integerFlag(flags, "interval") ??
    integerFlag(flags, "interval-ms") ??
    integerFlag(flags, "raw-interval-ms") ??
    1000;
  const jitterRatioStr = textFlag(flags, "jitter-ratio", false);
  const jitterRatio = jitterRatioStr !== undefined ? Number(jitterRatioStr) : undefined;
  const minRatioStr = textFlag(flags, "min-ratio", false);
  const minRatio = minRatioStr !== undefined ? Number(minRatioStr) : undefined;
  const maxRatioStr = textFlag(flags, "max-ratio", false);
  const maxRatio = maxRatioStr !== undefined ? Number(maxRatioStr) : undefined;
  const minIntervalMs = integerFlag(flags, "min-interval") ?? integerFlag(flags, "min-interval-ms");
  const maxIntervalMs = integerFlag(flags, "max-interval") ?? integerFlag(flags, "max-interval-ms");
  const seed = integerFlag(flags, "seed");

  const intervalMs =
    seed !== undefined
      ? calculateDeterministicInterval(rawIntervalMs, seed, {
          jitterRatio,
          minRatio,
          maxRatio,
          minIntervalMs,
          maxIntervalMs,
        })
      : applyIntervalJitter(rawIntervalMs, {
          jitterRatio,
          minRatio,
          maxRatio,
          minIntervalMs,
          maxIntervalMs,
        });

  return {
    intervalMs,
    rawIntervalMs,
    jitteredIntervalMs: intervalMs,
  };
}
