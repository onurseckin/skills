/**
 * B28.3 — the crux of unattended supervision: tell a transient failure (worth retrying) from a
 * deterministic one (worth stopping). Getting this wrong either burns a whole night retrying a
 * task that can never pass, or gives up on a task that would have succeeded on attempt two.
 */

/** What a dispatch or reclaim attempt actually reported, never inferred from a task's name or shape. */
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

/**
 * B28.3's own four, verbatim: "retry with exponential backoff plus jitter, **unbounded in count**
 * but bounded in total elapsed time." A rate limit, a DNS blip, a 502 and a host timeout describe
 * the WORLD outside the task — the far end having a bad moment — and the world does not get more
 * broken each time the identical message repeats. So a consecutive-repeat count must never demote
 * these to deterministic on its own; only the elapsed-time budget below may. Getting this backwards
 * (capping retry COUNT) is exactly the failure mode B28.3 warns against: giving up on a task that
 * would have gone through once the provider's bad moment passed, in a night that had time to spare.
 */
const UNBOUNDED_COUNT_TRANSIENT_SIGNALS: ReadonlySet<FailureSignal> = new Set([
  "rate_limit",
  "network",
  "provider_5xx",
  "timeout",
]);

/**
 * `crash` is transient too — B28.2's whole point is that a fresh agent deserves the next attempt —
 * but unlike the four above it describes the TASK's own agent dying, not the outside world. An agent
 * dying the identical way several times in a row for the same task IS evidence about the task (a
 * hang, a poisoned instruction, an unworkable scope), which is why this is the one transient signal
 * a repeat count is still allowed to demote to deterministic.
 */
const REPEAT_BOUNDED_TRANSIENT_SIGNALS: ReadonlySet<FailureSignal> = new Set(["crash"]);

/**
 * Every other signal — a gate that failed, an auth rejection — carries no reason to expect a retry
 * would behave differently, so it starts deterministic and only earns "transient" through this set.
 */
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
  /** Every earlier failure for this same task/gate, oldest first. Never includes the current one. */
  readonly priorFailures: readonly FailureRecord[];
  readonly now: Date;
  /** Consecutive identical failures at or past this count read as deterministic. Assumed, not measured. */
  readonly deterministicRepeatThreshold?: number;
  /** Total elapsed time across all attempts at or past this bound reads as deterministic. Assumed. */
  readonly maxElapsedMs?: number;
}

export interface ClassificationResult {
  readonly failureClass: FailureClass;
  readonly reason: string;
  /** How many times, including this one, the identical signal+detail has now occurred in a row. */
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

/**
 * Pure by design: every input is a value the caller already recorded (or is about to), so a
 * restarted supervisor reaches the identical verdict from the same event history without needing
 * any in-memory state of its own.
 */
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
  /** Injectable so tests can assert the jitter formula without depending on Math.random. */
  readonly random?: () => number;
}

const DEFAULT_INITIAL_DELAY_MS = 1_000;
const DEFAULT_MAX_DELAY_MS = 5 * 60_000;

/**
 * "Full jitter" (AWS's documented formula): a uniform draw between zero and the exponential cap,
 * rather than the cap itself. Unbounded in attempt count on its own — `classifyFailure`'s elapsed
 * and repeat bounds are what eventually stop the retries, not this function.
 */
export function nextBackoffDelayMs(repeatCount: number, config: BackoffConfig = {}): number {
  const initial = config.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const max = config.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const random = config.random ?? Math.random;
  const cap = Math.min(max, initial * 2 ** Math.max(0, repeatCount - 1));
  return Math.floor(random() * cap);
}
