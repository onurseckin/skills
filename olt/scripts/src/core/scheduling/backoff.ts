import {
  DEFAULT_MAX_INTERVAL_MS,
  QUIESCENCE_INTERVAL_MULTIPLIER,
  type BackoffStrategy,
  type BackoffStrategyOptions,
} from "./types.ts";

export function calculateExponentialBackoff(
  baseIntervalMs: number,
  maxIntervalMs: number = DEFAULT_MAX_INTERVAL_MS,
  streak: number = 0,
  multiplier: number = QUIESCENCE_INTERVAL_MULTIPLIER,
): number {
  const safeStreak = Math.max(0, streak);
  return Math.min(maxIntervalMs, Math.round(baseIntervalMs * Math.pow(multiplier, safeStreak)));
}

export function calculateBackoffWithStrategy(options: BackoffStrategyOptions): number {
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
