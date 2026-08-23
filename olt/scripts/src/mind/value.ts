import { HarnessError } from "../core/errors/harness-error.ts";

export const PULSE_OUTCOMES = [
  "rescued",
  "repaired",
  "advanced",
  "discovered",
  "proposed",
  "quiescent",
  "deferred",
  "paused",
  "escalated",
  "halted",
  "unarmed",
] as const;

export type PulseOutcome = (typeof PULSE_OUTCOMES)[number];

export const TERMINAL_OUTCOMES = ["halted", "unarmed"] as const;
export type TerminalOutcome = (typeof TERMINAL_OUTCOMES)[number];

export function isPulseOutcome(outcome: string): outcome is PulseOutcome {
  return (PULSE_OUTCOMES as readonly string[]).includes(outcome);
}

export function isTerminalOutcome(outcome: string): outcome is TerminalOutcome {
  return outcome === "halted" || outcome === "unarmed";
}

/**
 * Excluded metrics that are explicitly NEVER included in the pulse value calculation.
 * Per PLAN §11.2 and PHASE-5 §3.3: files touched, commands run, tokens spent, agents deployed,
 * and words written are activity metrics, NOT value metrics.
 */
export const EXCLUDED_VALUE_METRICS = [
  "files_touched",
  "commands_run",
  "tokens_spent",
  "agents_deployed",
  "words_written",
  "filesTouched",
  "commandsRun",
  "tokensSpent",
  "agentsDeployed",
  "wordsWritten",
] as const;

export type ExcludedValueMetric = (typeof EXCLUDED_VALUE_METRICS)[number];

/**
 * Legitimate harness-measured metrics included in the pulse value calculation.
 */
export const INCLUDED_VALUE_METRICS = [
  "leases_reclaimed",
  "findings_resolved",
  "gates_flipped_red_to_green",
  "tasks_reaching_done",
  "candidates_admitted",
  "proposals_recorded",
] as const;

export type IncludedValueMetric = (typeof INCLUDED_VALUE_METRICS)[number];

export function isExcludedValueMetric(metricName: string): boolean {
  return (EXCLUDED_VALUE_METRICS as readonly string[]).includes(metricName);
}

export function isIncludedValueMetric(metricName: string): boolean {
  return (INCLUDED_VALUE_METRICS as readonly string[]).includes(metricName);
}

export interface PulseValueMetrics {
  readonly leases_reclaimed?: number | undefined;
  readonly findings_resolved?: number | undefined;
  readonly gates_flipped_red_to_green?: number | undefined;
  readonly tasks_reaching_done?: number | undefined;
  readonly candidates_admitted?: number | undefined;
  readonly proposals_recorded?: number | undefined;

  readonly leasesReclaimed?: number | undefined;
  readonly findingsResolved?: number | undefined;
  readonly gatesFlippedRedToGreen?: number | undefined;
  readonly tasksReachingDone?: number | undefined;
  readonly candidatesAdmitted?: number | undefined;
  readonly proposalsRecorded?: number | undefined;

  // Excluded metrics for type safety testing
  readonly files_touched?: number | undefined;
  readonly commands_run?: number | undefined;
  readonly tokens_spent?: number | undefined;
  readonly agents_deployed?: number | undefined;
  readonly words_written?: number | undefined;
  readonly filesTouched?: number | undefined;
  readonly commandsRun?: number | undefined;
  readonly tokensSpent?: number | undefined;
  readonly agentsDeployed?: number | undefined;
  readonly wordsWritten?: number | undefined;
}

/**
 * Calculates pulse value per PLAN.md §11.2 and PHASE-5 §3.3:
 * value(pulse) = leases_reclaimed
 *              + findings_resolved
 *              + gates_flipped_red_to_green
 *              + tasks_reaching_done
 *              + candidates_admitted
 *              + proposals_recorded (capped at 1 per pulse)
 *
 * Strict mechanical accounting: Every term is a count the harness measured.
 * Explicitly ignored: files touched, commands run, tokens spent, agents deployed, words written.
 */
export function calculatePulseValue(
  metrics: PulseValueMetrics | Record<string, unknown> = {},
): number {
  const getMetric = (snakeKey: string, camelKey: string): number => {
    const rawVal =
      (metrics as Record<string, unknown>)[snakeKey] ??
      (metrics as Record<string, unknown>)[camelKey];
    if (typeof rawVal === "number" && Number.isFinite(rawVal)) {
      return Math.max(0, Math.floor(rawVal));
    }
    return 0;
  };

  const leasesReclaimed = getMetric("leases_reclaimed", "leasesReclaimed");
  const findingsResolved = getMetric("findings_resolved", "findingsResolved");
  const gatesFlipped = getMetric("gates_flipped_red_to_green", "gatesFlippedRedToGreen");
  const tasksDone = getMetric("tasks_reaching_done", "tasksReachingDone");
  const candidatesAdmitted = getMetric("candidates_admitted", "candidatesAdmitted");
  const rawProposals = getMetric("proposals_recorded", "proposalsRecorded");
  const proposalsRecorded = Math.min(1, rawProposals);

  return (
    leasesReclaimed +
    findingsResolved +
    gatesFlipped +
    tasksDone +
    candidatesAdmitted +
    proposalsRecorded
  );
}

/**
 * Parses duration strings like "15m", "4h", "30s", "500ms" or numeric milliseconds into non-negative integer ms.
 */
export function parseDuration(raw: string | number): number {
  if (typeof raw === "number") {
    if (Number.isFinite(raw) && raw >= 0) return Math.round(raw);
    throw new HarnessError("INVALID_ARGUMENT", `invalid duration number: ${raw}`);
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `invalid duration '${raw}'; expected format like 15m, 4h, 30s, or non-negative milliseconds`,
    );
  }
  const lower = trimmed.toLowerCase();
  if (lower.endsWith("ms")) {
    const val = Number(lower.slice(0, -2).trim());
    if (Number.isFinite(val) && val >= 0) return Math.round(val);
  }
  if (lower.endsWith("s")) {
    const val = Number(lower.slice(0, -1).trim());
    if (Number.isFinite(val) && val >= 0) return Math.round(val * 1000);
  }
  if (lower.endsWith("m")) {
    const val = Number(lower.slice(0, -1).trim());
    if (Number.isFinite(val) && val >= 0) return Math.round(val * 60 * 1000);
  }
  if (lower.endsWith("h")) {
    const val = Number(lower.slice(0, -1).trim());
    if (Number.isFinite(val) && val >= 0) return Math.round(val * 60 * 60 * 1000);
  }
  if (lower.endsWith("d")) {
    const val = Number(lower.slice(0, -1).trim());
    if (Number.isFinite(val) && val >= 0) return Math.round(val * 24 * 60 * 60 * 1000);
  }
  const val = Number(trimmed);
  if (Number.isFinite(val) && val >= 0) return Math.round(val);
  throw new HarnessError(
    "INVALID_ARGUMENT",
    `invalid duration '${raw}'; expected format like 15m, 4h, 30s, or non-negative milliseconds`,
  );
}

/**
 * Computes raw quiescent backoff interval: min(maxIntervalMs, round(baseIntervalMs * 1.5^streak))
 */
export function calculateQuiescentBackoffInterval(
  baseIntervalMs: number,
  maxIntervalMs: number,
  streak: number,
): number {
  const safeStreak = Math.max(0, streak);
  return Math.min(maxIntervalMs, Math.round(baseIntervalMs * Math.pow(1.5, safeStreak)));
}

export interface NextWakeIntervalOptions {
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

export interface NextWakeIntervalResult {
  readonly intervalMs: number | null;
  readonly rawIntervalMs: number | null;
  readonly zeroValueStreak: number;
  readonly isTerminal: boolean;
}

/**
 * Calculates next wake interval with bounded backoff per PLAN.md §11.2 / §9.4 and PHASE-1.md W1.6:
 * - Terminal outcomes (halted, unarmed): does not arm (intervalMs = null).
 * - Rate limit / paused: doubles interval up to maxPauseIntervalMs.
 * - value > 0: resets interval to baseIntervalMs, resets streak to 0.
 * - value == 0: quiescent streak increments, interval = min(maxIntervalMs, baseIntervalMs * 1.5^nextStreak).
 * - Optional jitter: applies bounded jitter if requested.
 */
export function calculateNextWakeInterval(
  options: NextWakeIntervalOptions,
): NextWakeIntervalResult {
  const {
    baseIntervalMs,
    maxIntervalMs,
    maxPauseIntervalMs = 1_800_000,
    previousIntervalMs,
    zeroValueStreak,
    value,
    outcome,
    signal,
    applyJitter = false,
    random = Math.random,
    jitterRatio = 0.15,
  } = options;

  if (outcome === "halted" || outcome === "unarmed") {
    return {
      intervalMs: null,
      rawIntervalMs: null,
      zeroValueStreak: 0,
      isTerminal: true,
    };
  }

  const isRateLimited = signal === "rate_limit" || outcome === "paused";

  let nextStreak = zeroValueStreak;
  let rawInterval: number;

  if (isRateLimited) {
    const prev =
      previousIntervalMs !== undefined && previousIntervalMs > 0
        ? previousIntervalMs
        : baseIntervalMs;
    rawInterval = Math.min(maxPauseIntervalMs, prev * 2);
    nextStreak = value > 0 ? 0 : zeroValueStreak + 1;
  } else if (value > 0) {
    nextStreak = 0;
    rawInterval = baseIntervalMs;
  } else {
    nextStreak = zeroValueStreak + 1;
    rawInterval = calculateQuiescentBackoffInterval(baseIntervalMs, maxIntervalMs, nextStreak);
  }

  let finalInterval = rawInterval;
  if (applyJitter && rawInterval > 0) {
    const clampedRatio = Math.max(0.1, Math.min(0.2, jitterRatio));
    const jitterFactor = (random() * 2 - 1) * clampedRatio;
    const jittered = Math.round(rawInterval * (1 + jitterFactor));
    finalInterval = Math.max(1000, Math.min(maxIntervalMs, jittered));
  }

  return {
    intervalMs: finalInterval,
    rawIntervalMs: rawInterval,
    zeroValueStreak: nextStreak,
    isTerminal: false,
  };
}
