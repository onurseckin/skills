import { describe, expect, test } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  applyIntervalJitter,
  calculateExponentialBackoff,
  calculateThrottleInterval,
  DEFAULT_BASE_INTERVAL_MS,
  DEFAULT_JITTER_RATIO,
  DEFAULT_MAX_INTERVAL_MS,
  DEFAULT_MAX_PAUSE_INTERVAL_MS,
  extractTrailingValueSeriesFromEvents,
  extractTrailingValueSeriesFromState,
  formatRawValueSeries,
  generateTrailingValueSeries,
  MAX_JITTER_RATIO,
  MIN_INTERVAL_MS,
  type TrailingValuePoint,
} from "../../../olt/scripts/src/mind/lifecycle/interval/index.ts";
import {
  calculatePulseValue,
  calculateQuiescentBackoffInterval,
  calculateNextWakeInterval,
  EXCLUDED_VALUE_METRICS,
  INCLUDED_VALUE_METRICS,
  isExcludedValueMetric,
  isIncludedValueMetric,
  isPulseOutcome,
  isTerminalOutcome,
  parseDuration,
  PULSE_OUTCOMES,
  TERMINAL_OUTCOMES,
  type PulseValueMetrics,
} from "../../../olt/scripts/src/mind/memory/index.ts";

describe("Mechanical Value Accounting (PLAN §11.2, PHASE-5 §3.3)", () => {
  test("value formula strictly sums only the 6 harness-measured metrics", () => {
    const metrics: PulseValueMetrics = {
      leases_reclaimed: 2,
      findings_resolved: 3,
      gates_flipped_red_to_green: 1,
      tasks_reaching_done: 4,
      candidates_admitted: 5,
      proposals_recorded: 1,
    };

    const value = calculatePulseValue(metrics);
    expect(value).toBe(2 + 3 + 1 + 4 + 5 + 1); // 16
  });

  test("proposals_recorded is strictly capped at 1 per pulse", () => {
    expect(calculatePulseValue({ proposals_recorded: 0 })).toBe(0);
    expect(calculatePulseValue({ proposals_recorded: 1 })).toBe(1);
    expect(calculatePulseValue({ proposals_recorded: 2 })).toBe(1);
    expect(calculatePulseValue({ proposals_recorded: 5 })).toBe(1);
    expect(calculatePulseValue({ proposals_recorded: 100 })).toBe(1);

    expect(calculatePulseValue({ proposalsRecorded: 0 })).toBe(0);
    expect(calculatePulseValue({ proposalsRecorded: 1 })).toBe(1);
    expect(calculatePulseValue({ proposalsRecorded: 99 })).toBe(1);
  });

  test("all 5 excluded metrics (tokens, files, commands, agents, words) contribute ZERO to value", () => {
    // Large activity numbers should contribute nothing
    const excludedOnlyMetrics: PulseValueMetrics = {
      files_touched: 500,
      commands_run: 1000,
      tokens_spent: 50_000_000,
      agents_deployed: 50,
      words_written: 100_000,
      filesTouched: 300,
      commandsRun: 2000,
      tokensSpent: 10_000_000,
      agentsDeployed: 20,
      wordsWritten: 50_000,
    };

    expect(calculatePulseValue(excludedOnlyMetrics)).toBe(0);

    // Combined with valid value metric: only valid metric counted
    const mixedMetrics: PulseValueMetrics = {
      ...excludedOnlyMetrics,
      tasks_reaching_done: 3,
      findings_resolved: 2,
    };

    expect(calculatePulseValue(mixedMetrics)).toBe(5);
  });

  test("isExcludedValueMetric and isIncludedValueMetric accurately identify metric categories", () => {
    for (const metric of EXCLUDED_VALUE_METRICS) {
      expect(isExcludedValueMetric(metric)).toBe(true);
      expect(isIncludedValueMetric(metric)).toBe(false);
    }

    for (const metric of INCLUDED_VALUE_METRICS) {
      expect(isIncludedValueMetric(metric)).toBe(true);
      expect(isExcludedValueMetric(metric)).toBe(false);
    }
  });

  test("calculatePulseValue gracefully handles empty, partial, or malformed metric objects", () => {
    expect(calculatePulseValue({})).toBe(0);
    expect(calculatePulseValue({ leases_reclaimed: undefined })).toBe(0);
    expect(calculatePulseValue({ findings_resolved: -10 })).toBe(0);
    expect(
      calculatePulseValue({
        leases_reclaimed: 3.8, // floored
        tasks_reaching_done: 2.1, // floored
      }),
    ).toBe(5);
  });

  test("parseDuration parses various unit formats and rejects invalid strings", () => {
    expect(parseDuration(1000)).toBe(1000);
    expect(parseDuration("500ms")).toBe(500);
    expect(parseDuration("30s")).toBe(30_000);
    expect(parseDuration("15m")).toBe(900_000);
    expect(parseDuration("4h")).toBe(14_400_000);
    expect(parseDuration("1d")).toBe(86_400_000);
    expect(parseDuration("900000")).toBe(900_000);

    expect(() => parseDuration("invalid")).toThrow(HarnessError);
    expect(() => parseDuration(-10)).toThrow(HarnessError);
    expect(() => parseDuration("")).toThrow(HarnessError);
  });

  test("pulse outcomes and terminal outcomes classifications", () => {
    expect(PULSE_OUTCOMES.length).toBe(11);
    expect(TERMINAL_OUTCOMES).toEqual(["halted", "unarmed"]);

    for (const outcome of PULSE_OUTCOMES) {
      expect(isPulseOutcome(outcome)).toBe(true);
    }
    expect(isPulseOutcome("unknown-outcome")).toBe(false);

    expect(isTerminalOutcome("halted")).toBe(true);
    expect(isTerminalOutcome("unarmed")).toBe(true);
    expect(isTerminalOutcome("quiescent")).toBe(false);
    expect(isTerminalOutcome("advanced")).toBe(false);
  });
});

describe("Jittered Exponential Backoff Throttle (PLAN §11.2, PHASE-5 §3.3)", () => {
  const base = DEFAULT_BASE_INTERVAL_MS; // 900_000 ms (15m)
  const max = DEFAULT_MAX_INTERVAL_MS; // 14_400_000 ms (4h)

  test("exponential backoff table: 1.5^K progression up to max_interval cap", () => {
    expect(calculateExponentialBackoff(base, max, 0)).toBe(900_000); // 15m
    expect(calculateExponentialBackoff(base, max, 1)).toBe(1_350_000); // 22.5m (15m * 1.5)
    expect(calculateExponentialBackoff(base, max, 2)).toBe(2_025_000); // 33.75m (15m * 2.25)
    expect(calculateExponentialBackoff(base, max, 3)).toBe(3_037_500); // ~50.6m
    expect(calculateExponentialBackoff(base, max, 4)).toBe(4_556_250); // ~75.9m
    expect(calculateExponentialBackoff(base, max, 5)).toBe(6_834_375); // ~113.9m
    expect(calculateExponentialBackoff(base, max, 6)).toBe(10_251_563); // ~170.8m
    // At K=7: 900_000 * 1.5^7 = 15_377_344 -> capped at 14_400_000
    expect(calculateExponentialBackoff(base, max, 7)).toBe(14_400_000);
    expect(calculateExponentialBackoff(base, max, 8)).toBe(14_400_000);
    expect(calculateExponentialBackoff(base, max, 50)).toBe(14_400_000);

    // Negative or zero streak returns base
    expect(calculateExponentialBackoff(base, max, -1)).toBe(900_000);
  });

  test("reset on positive value: value > 0 resets interval to base_interval and streak to 0", () => {
    const result = calculateThrottleInterval({
      baseIntervalMs: base,
      maxIntervalMs: max,
      zeroValueStreak: 6, // previous high streak
      value: 1, // positive value delivered
      applyJitter: false,
    });

    expect(result.isReset).toBe(true);
    expect(result.zeroValueStreak).toBe(0);
    expect(result.rawIntervalMs).toBe(base);
    expect(result.intervalMs).toBe(base);
    expect(result.isTerminal).toBe(false);
  });

  test("consecutive zeroes: value == 0 increments streak and computes 1.5^K backoff", () => {
    // Pulse 1 with 0 value (streak goes from 0 to 1)
    const r1 = calculateThrottleInterval({
      baseIntervalMs: base,
      maxIntervalMs: max,
      zeroValueStreak: 0,
      value: 0,
      applyJitter: false,
    });
    expect(r1.zeroValueStreak).toBe(1);
    expect(r1.rawIntervalMs).toBe(1_350_000);

    // Pulse 2 with 0 value (streak goes from 1 to 2)
    const r2 = calculateThrottleInterval({
      baseIntervalMs: base,
      maxIntervalMs: max,
      zeroValueStreak: 1,
      value: 0,
      applyJitter: false,
    });
    expect(r2.zeroValueStreak).toBe(2);
    expect(r2.rawIntervalMs).toBe(2_025_000);

    // Pulse 7 with 0 value (capped at max)
    const r7 = calculateThrottleInterval({
      baseIntervalMs: base,
      maxIntervalMs: max,
      zeroValueStreak: 6,
      value: 0,
      applyJitter: false,
    });
    expect(r7.zeroValueStreak).toBe(7);
    expect(r7.rawIntervalMs).toBe(max);
  });

  test("rate limit or paused outcome doubles previous interval up to maxPauseIntervalMs", () => {
    const res = calculateThrottleInterval({
      baseIntervalMs: base,
      maxIntervalMs: max,
      maxPauseIntervalMs: DEFAULT_MAX_PAUSE_INTERVAL_MS,
      previousIntervalMs: 600_000,
      zeroValueStreak: 2,
      value: 0,
      outcome: "paused",
      signal: "rate_limit",
      applyJitter: false,
    });

    expect(res.isRateLimited).toBe(true);
    expect(res.rawIntervalMs).toBe(1_200_000); // 600_000 * 2
  });

  test("terminal outcomes (halted, unarmed) return intervalMs = null and isTerminal = true", () => {
    const haltedRes = calculateThrottleInterval({
      baseIntervalMs: base,
      maxIntervalMs: max,
      zeroValueStreak: 3,
      value: 0,
      outcome: "halted",
    });
    expect(haltedRes.isTerminal).toBe(true);
    expect(haltedRes.intervalMs).toBeNull();
    expect(haltedRes.rawIntervalMs).toBeNull();

    const unarmedRes = calculateThrottleInterval({
      baseIntervalMs: base,
      maxIntervalMs: max,
      zeroValueStreak: 3,
      value: 0,
      outcome: "unarmed",
    });
    expect(unarmedRes.isTerminal).toBe(true);
    expect(unarmedRes.intervalMs).toBeNull();
  });
});

describe("Mandatory Random Jitter & Bounds (+/- 10-20%)", () => {
  const rawInterval = 1_000_000;

  test("deterministic jitter: random=0 gives lower bound, random=0.5 gives center, random=1 gives upper bound", () => {
    // Target ratio 15% (factor in [-0.15, +0.15])
    const lower = applyIntervalJitter(rawInterval, {
      jitterRatio: 0.15,
      random: () => 0.0,
    });
    expect(lower).toBe(850_000); // 1,000,000 * (1 - 0.15)

    const center = applyIntervalJitter(rawInterval, {
      jitterRatio: 0.15,
      random: () => 0.5,
    });
    expect(center).toBe(1_000_000); // 1,000,000 * (1 + 0)

    const upper = applyIntervalJitter(rawInterval, {
      jitterRatio: 0.15,
      random: () => 0.99999999,
    });
    expect(upper).toBe(1_150_000); // 1,000,000 * (1 + 0.15)
  });

  test("jitter ratio is strictly clamped within [10%, 20%] bounds", () => {
    // If 5% requested -> clamped to 10%
    const lowerClamped = applyIntervalJitter(rawInterval, {
      jitterRatio: 0.05,
      random: () => 0.0,
    });
    expect(lowerClamped).toBe(900_000); // 1,000,000 * (1 - 0.10)

    // If 40% requested -> clamped to 20%
    const upperClamped = applyIntervalJitter(rawInterval, {
      jitterRatio: 0.4,
      random: () => 0.99999999,
    });
    expect(upperClamped).toBe(1_200_000); // 1,000,000 * (1 + 0.20)
  });

  test("statistical verification: 1,000 random samples strictly respect +/- 20% bounds and min limit", () => {
    const raw = 900_000;
    const minBound = raw * (1 - MAX_JITTER_RATIO); // 720,000
    const maxBound = raw * (1 + MAX_JITTER_RATIO); // 1,080,000

    const samples: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const j = applyIntervalJitter(raw, { jitterRatio: DEFAULT_JITTER_RATIO });
      expect(j).toBeGreaterThanOrEqual(minBound);
      expect(j).toBeLessThanOrEqual(maxBound);
      expect(j).toBeGreaterThanOrEqual(MIN_INTERVAL_MS);
      samples.push(j);
    }

    // Verify samples are not all identical (thundering herd prevention)
    const unique = new Set(samples);
    expect(unique.size).toBeGreaterThan(100);
  });
});

describe("Trailing Value Series Generator for Owner Digest (PLAN §11.2, PHASE-5 §3.3)", () => {
  test("generates trailing value series with raw counts and zero streak", () => {
    const points: TrailingValuePoint[] = [
      { pulseId: "pulse-1", outcome: "advanced", value: 3 },
      { pulseId: "pulse-2", outcome: "rescued", value: 1 },
      { pulseId: "pulse-3", outcome: "quiescent", value: 0 },
      { pulseId: "pulse-4", outcome: "proposed", value: 1 },
      { pulseId: "pulse-5", outcome: "quiescent", value: 0 },
      { pulseId: "pulse-6", outcome: "quiescent", value: 0 },
    ];

    const series = generateTrailingValueSeries(points);
    expect(series.rawValues).toEqual([3, 1, 0, 1, 0, 0]);
    expect(series.totalValue).toBe(5);
    expect(series.trailingZeroStreak).toBe(2);
    expect(series.isFlatZero).toBe(false);
    expect(series.formattedSeries).toBe("[3, 1, 0, 1, 0, 0]");
    expect(series.markdown).toContain("- **Raw Series**: `[3, 1, 0, 1, 0, 0]`");
    expect(series.markdown).toContain("- **Total Value**: 5");
    expect(series.markdown).toContain("- **Trailing Zero Streak**: 2");
  });

  test("detects long flat zero series without hiding it behind a summary", () => {
    const flatZeroPoints: TrailingValuePoint[] = [
      { pulseId: "pulse-1", outcome: "quiescent", value: 0 },
      { pulseId: "pulse-2", outcome: "quiescent", value: 0 },
      { pulseId: "pulse-3", outcome: "quiescent", value: 0 },
      { pulseId: "pulse-4", outcome: "quiescent", value: 0 },
      { pulseId: "pulse-5", outcome: "quiescent", value: 0 },
      { pulseId: "pulse-6", outcome: "quiescent", value: 0 },
      { pulseId: "pulse-7", outcome: "quiescent", value: 0 },
      { pulseId: "pulse-8", outcome: "quiescent", value: 0 },
    ];

    const series = generateTrailingValueSeries(flatZeroPoints);
    expect(series.rawValues).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(series.totalValue).toBe(0);
    expect(series.trailingZeroStreak).toBe(8);
    expect(series.isFlatZero).toBe(true);
    expect(series.markdown).toContain("Flat Zero Series");
    expect(series.markdown).toContain(
      "A long flat zero is either a healthy repository or a broken mind",
    );
  });

  test("extracts trailing value series from state and events cleanly", () => {
    const state: Record<string, unknown> = {
      pulse: {
        history: [
          { pulse_id: "pulse-1", outcome: "advanced", value: 2, closed_at: "2026-08-21T01:00:00Z" },
          {
            pulse_id: "pulse-2",
            outcome: "quiescent",
            value: 0,
            closed_at: "2026-08-21T02:00:00Z",
          },
        ],
      },
    };

    const stateSeries = extractTrailingValueSeriesFromState(state);
    expect(stateSeries.rawValues).toEqual([2, 0]);
    expect(stateSeries.trailingZeroStreak).toBe(1);

    const events: Record<string, unknown>[] = [
      {
        kind: "mind-pulse-closed",
        payload: { pulse_id: "pulse-1", outcome: "advanced", value: 4 },
        timestamp: "2026-08-21T01:00:00Z",
      },
      {
        kind: "mind-pulse-closed",
        payload: { pulse_id: "pulse-2", outcome: "quiescent", value: 0 },
        timestamp: "2026-08-21T02:00:00Z",
      },
    ];

    const eventSeries = extractTrailingValueSeriesFromEvents(events);
    expect(eventSeries.rawValues).toEqual([4, 0]);
    expect(formatRawValueSeries(eventSeries.rawValues)).toBe("[4, 0]");
  });

  test("calculates quiescent backoff interval cleanly", () => {
    expect(calculateQuiescentBackoffInterval(10_000, 60_000, 0)).toBe(10_000);
    expect(calculateQuiescentBackoffInterval(10_000, 60_000, 1)).toBe(15_000);
    expect(calculateQuiescentBackoffInterval(10_000, 60_000, 2)).toBe(22_500);
    expect(calculateQuiescentBackoffInterval(10_000, 60_000, 10)).toBe(60_000);
  });

  test("calculates next wake interval for all outcome branches and jitter", () => {
    // 1. Terminal outcomes
    const halted = calculateNextWakeInterval({
      baseIntervalMs: 10_000,
      maxIntervalMs: 60_000,
      zeroValueStreak: 3,
      value: 0,
      outcome: "halted",
    });
    expect(halted.isTerminal).toBe(true);
    expect(halted.intervalMs).toBeNull();

    const unarmed = calculateNextWakeInterval({
      baseIntervalMs: 10_000,
      maxIntervalMs: 60_000,
      zeroValueStreak: 3,
      value: 0,
      outcome: "unarmed",
    });
    expect(unarmed.isTerminal).toBe(true);
    expect(unarmed.intervalMs).toBeNull();

    // 2. Rate limited / paused
    const rateLimited = calculateNextWakeInterval({
      baseIntervalMs: 10_000,
      maxIntervalMs: 60_000,
      previousIntervalMs: 20_000,
      zeroValueStreak: 2,
      value: 0,
      signal: "rate_limit",
    });
    expect(rateLimited.rawIntervalMs).toBe(40_000);
    expect(rateLimited.zeroValueStreak).toBe(3);

    const rateLimitedWithValue = calculateNextWakeInterval({
      baseIntervalMs: 10_000,
      maxIntervalMs: 60_000,
      previousIntervalMs: 20_000,
      zeroValueStreak: 2,
      value: 5,
      outcome: "paused",
    });
    expect(rateLimitedWithValue.zeroValueStreak).toBe(0);

    // 3. Value > 0 resets streak and interval
    const positiveValue = calculateNextWakeInterval({
      baseIntervalMs: 10_000,
      maxIntervalMs: 60_000,
      zeroValueStreak: 5,
      value: 2,
    });
    expect(positiveValue.zeroValueStreak).toBe(0);
    expect(positiveValue.rawIntervalMs).toBe(10_000);

    // 4. Value == 0 backs off
    const zeroVal = calculateNextWakeInterval({
      baseIntervalMs: 10_000,
      maxIntervalMs: 60_000,
      zeroValueStreak: 0,
      value: 0,
    });
    expect(zeroVal.zeroValueStreak).toBe(1);
    expect(zeroVal.rawIntervalMs).toBe(15_000);

    // 5. Jitter applied
    const jittered = calculateNextWakeInterval({
      baseIntervalMs: 10_000,
      maxIntervalMs: 60_000,
      zeroValueStreak: 0,
      value: 0,
      applyJitter: true,
      jitterRatio: 0.15,
      random: () => 0.8,
    });
    expect(jittered.intervalMs).toBeGreaterThan(0);
  });
});
