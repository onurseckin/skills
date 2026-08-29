import {
  DEFAULT_JITTER_RATIO,
  DEFAULT_MAX_INTERVAL_MS,
  MAX_JITTER_RATIO,
  MIN_INTERVAL_MS,
  MIN_JITTER_RATIO,
  type CompositeSeedOptions,
  type JitterOptions,
} from "./types.ts";

export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function createCompositeSeed(options: CompositeSeedOptions = {}): number {
  const parts: string[] = [
    options.agentId ?? "",
    options.role ?? "",
    options.taskId ?? "",
    options.salt !== undefined ? String(options.salt) : "",
    options.iteration !== undefined ? String(options.iteration) : "",
    options.timestamp !== undefined
      ? String(options.timestamp instanceof Date ? options.timestamp.getTime() : options.timestamp)
      : "",
  ];
  return fnv1a32(parts.join(":"));
}

export function createDeterministicRandom(seed: number): () => number {
  let s = Math.trunc(seed) >>> 0;
  return function mulberry32(): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function applyIntervalJitter(rawIntervalMs: number, options: JitterOptions = {}): number {
  if (rawIntervalMs <= 0) return Math.max(0, rawIntervalMs);

  const randomFn = options.random ?? Math.random;
  const targetRatio = options.jitterRatio ?? DEFAULT_JITTER_RATIO;
  const minRatio = options.minRatio ?? MIN_JITTER_RATIO;
  const maxRatio = options.maxRatio ?? MAX_JITTER_RATIO;
  const clampedRatio = Math.max(minRatio, Math.min(maxRatio, targetRatio));

  const r = randomFn();
  const factor = (r * 2 - 1) * clampedRatio;
  const jittered = Math.round(rawIntervalMs * (1 + factor));

  const minLimit = options.minIntervalMs ?? MIN_INTERVAL_MS;
  const maxLimit = options.maxIntervalMs ?? DEFAULT_MAX_INTERVAL_MS;

  return Math.max(minLimit, Math.min(maxLimit, jittered));
}

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
