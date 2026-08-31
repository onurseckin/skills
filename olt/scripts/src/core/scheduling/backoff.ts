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

export interface ProjectProgressionOptions {
  readonly baseIntervalMs: number;
  readonly maxIntervalMs: number;
  readonly steps: number;
  readonly multiplier?: number | undefined;
  readonly strategy?: BackoffStrategy | undefined;
}

export function projectIntervalProgression(
  optionsOrBase: number | ProjectProgressionOptions,
  maxIntervalMs?: number,
  steps?: number,
  strategy?: BackoffStrategy,
  multiplier?: number,
): readonly number[] {
  if (typeof optionsOrBase === "number") {
    const base = optionsOrBase;
    const max = maxIntervalMs ?? DEFAULT_MAX_INTERVAL_MS;
    const s = steps ?? 0;
    return projectIntervalProgression({
      baseIntervalMs: base,
      maxIntervalMs: max,
      steps: s,
      strategy,
      multiplier,
    });
  }

  const { baseIntervalMs, maxIntervalMs: max, steps: s, multiplier: mult, strategy: strat } =
    optionsOrBase;
  const safeSteps = Math.max(0, s);
  const progression: number[] = [];

  for (let streak = 0; streak < safeSteps; streak++) {
    progression.push(
      calculateBackoffWithStrategy({
        baseIntervalMs,
        maxIntervalMs: max,
        streak,
        strategy: strat,
        multiplier: mult,
      }),
    );
  }

  return progression;
}
