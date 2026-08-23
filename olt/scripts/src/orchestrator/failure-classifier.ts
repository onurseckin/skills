export type FailureSignal =
  | "rate_limit"
  | "network"
  | "provider_5xx"
  | "timeout"
  | "auth"
  | "gate_failure"
  | "crash"
  | "unknown";

export type FailureClass = "transient" | "deterministic";

const UNBOUNDED_COUNT_TRANSIENT_SIGNALS: ReadonlySet<FailureSignal> = new Set([
  "rate_limit",
  "network",
  "provider_5xx",
  "timeout",
]);

const REPEAT_BOUNDED_TRANSIENT_SIGNALS: ReadonlySet<FailureSignal> = new Set(["crash"]);

const TRANSIENT_SIGNALS: ReadonlySet<FailureSignal> = new Set([
  ...UNBOUNDED_COUNT_TRANSIENT_SIGNALS,
  ...REPEAT_BOUNDED_TRANSIENT_SIGNALS,
]);

export interface FailureRecord {
  readonly signal: FailureSignal;
  readonly detail: string;
  readonly at: string;
}

export interface ClassifyInput {
  readonly signal: FailureSignal;
  readonly detail: string;
  readonly priorFailures: readonly FailureRecord[];
  readonly now: Date;
  readonly deterministicRepeatThreshold?: number;
  readonly maxElapsedMs?: number;
}

export interface ClassificationResult {
  readonly failureClass: FailureClass;
  readonly reason: string;
  readonly repeatCount: number;
  readonly elapsedMs: number;
}

const DEFAULT_DETERMINISTIC_REPEAT_THRESHOLD = 3;
const DEFAULT_MAX_ELAPSED_MS = 4 * 60 * 60_000;

function consecutiveRepeats(
  signal: FailureSignal,
  detail: string,
  prior: readonly FailureRecord[],
): number {
  let count = 0;
  for (let i = prior.length - 1; i >= 0; i--) {
    const entry = prior[i]!;
    if (entry.signal !== signal || entry.detail !== detail) break;
    count++;
  }
  return count;
}

export function classifyFailure(input: ClassifyInput): ClassificationResult {
  const threshold = input.deterministicRepeatThreshold ?? DEFAULT_DETERMINISTIC_REPEAT_THRESHOLD;
  const maxElapsedMs = input.maxElapsedMs ?? DEFAULT_MAX_ELAPSED_MS;
  const repeatCount = consecutiveRepeats(input.signal, input.detail, input.priorFailures) + 1;
  const first = input.priorFailures[0];
  const elapsedMs = first === undefined ? 0 : input.now.valueOf() - Date.parse(first.at);

  if (!TRANSIENT_SIGNALS.has(input.signal)) {
    return {
      failureClass: "deterministic",
      reason: `"${input.signal}" carries no reason to expect a retry would behave differently`,
      repeatCount,
      elapsedMs,
    };
  }
  if (REPEAT_BOUNDED_TRANSIENT_SIGNALS.has(input.signal) && repeatCount >= threshold) {
    return {
      failureClass: "deterministic",
      reason: `the same "${input.signal}" failure ("${input.detail}") repeated ${repeatCount} times in a row`,
      repeatCount,
      elapsedMs,
    };
  }
  if (elapsedMs >= maxElapsedMs) {
    return {
      failureClass: "deterministic",
      reason: `retrying for ${elapsedMs}ms exceeded the ${maxElapsedMs}ms elapsed budget without a success`,
      repeatCount,
      elapsedMs,
    };
  }
  return {
    failureClass: "transient",
    reason: `"${input.signal}" is a transient provider/network signal, attempt ${repeatCount}`,
    repeatCount,
    elapsedMs,
  };
}

export interface BackoffConfig {
  readonly initialDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly random?: () => number;
}

const DEFAULT_INITIAL_DELAY_MS = 1_000;
const DEFAULT_MAX_DELAY_MS = 5 * 60_000;

export function nextBackoffDelayMs(repeatCount: number, config: BackoffConfig = {}): number {
  const initial = config.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const max = config.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const random = config.random ?? Math.random;
  const cap = Math.min(max, initial * 2 ** Math.max(0, repeatCount - 1));
  return Math.floor(random() * cap);
}
