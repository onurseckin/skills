import { describe, expect, it } from "bun:test";
import { HarnessError } from "../../../../../olt/scripts/src/core/errors/index.ts";
import {
  calculateNextWakeInterval,
  calculatePulseValue,
  calculateQuiescentBackoffInterval,
  EXCLUDED_VALUE_METRICS,
  INCLUDED_VALUE_METRICS,
  isExcludedValueMetric,
  isIncludedValueMetric,
  isPulseOutcome,
  isTerminalOutcome,
  parseDuration,
  PULSE_OUTCOMES,
  TERMINAL_OUTCOMES,
} from "../../../../../olt/scripts/src/mind/memory/value/index.ts";

describe("Mind Memory Value Calculation & Pulse Metrics Suite", () => {
  describe("Metric Inclusion & Exclusion Predicates", () => {
    it("identifies canonical and camelCase included metrics accurately", () => {
      for (const metric of INCLUDED_VALUE_METRICS) {
        expect(isIncludedValueMetric(metric)).toBe(true);
      }
      expect(isIncludedValueMetric("leasesReclaimed")).toBe(true);
      expect(isIncludedValueMetric("findingsResolved")).toBe(true);
      expect(isIncludedValueMetric("gatesFlippedRedToGreen")).toBe(true);
      expect(isIncludedValueMetric("tasksReachingDone")).toBe(true);
      expect(isIncludedValueMetric("candidatesAdmitted")).toBe(true);
      expect(isIncludedValueMetric("proposalsRecorded")).toBe(true);

      expect(isIncludedValueMetric("tokens_spent")).toBe(false);
      expect(isIncludedValueMetric("arbitrary_metric")).toBe(false);
      expect(isIncludedValueMetric("")).toBe(false);
    });

    it("identifies canonical and camelCase excluded metrics accurately", () => {
      for (const metric of EXCLUDED_VALUE_METRICS) {
        expect(isExcludedValueMetric(metric)).toBe(true);
      }
      expect(isExcludedValueMetric("tokensSpent")).toBe(true);
      expect(isExcludedValueMetric("filesTouched")).toBe(true);
      expect(isExcludedValueMetric("commandsRun")).toBe(true);
      expect(isExcludedValueMetric("agentsDeployed")).toBe(true);
      expect(isExcludedValueMetric("wordsWritten")).toBe(true);

      expect(isExcludedValueMetric("leases_reclaimed")).toBe(false);
      expect(isExcludedValueMetric("arbitrary_metric")).toBe(false);
    });
  });

  describe("calculatePulseValue", () => {
    it("returns zero when pulse metrics object is empty", () => {
      expect(calculatePulseValue({})).toBe(0);
    });

    it("aggregates snake_case and camelCase metrics correctly", () => {
      const snakeVal = calculatePulseValue({
        leases_reclaimed: 2,
        findings_resolved: 3,
        gates_flipped_red_to_green: 1,
        tasks_reaching_done: 4,
        candidates_admitted: 2,
        proposals_recorded: 5,
      });
      expect(snakeVal).toBe(2 + 3 + 1 + 4 + 2 + 1);

      const camelVal = calculatePulseValue({
        leasesReclaimed: 1,
        findingsResolved: 2,
        gatesFlippedRedToGreen: 1,
        tasksReachingDone: 3,
        candidatesAdmitted: 1,
        proposalsRecorded: 1,
      });
      expect(camelVal).toBe(1 + 2 + 1 + 3 + 1 + 1);
    });

    it("caps proposal value strictly at binary one", () => {
      expect(calculatePulseValue({ proposals_recorded: 0 })).toBe(0);
      expect(calculatePulseValue({ proposals_recorded: 1 })).toBe(1);
      expect(calculatePulseValue({ proposals_recorded: 100 })).toBe(1);
    });

    it("clamps negative numbers and floors fractional inputs", () => {
      const val = calculatePulseValue({
        leases_reclaimed: -5,
        findings_resolved: 3.8,
        tasks_reaching_done: 2.1,
      });
      expect(val).toBe(0 + 3 + 2);
    });
  });

  describe("Pulse Outcomes & Terminal Predicates", () => {
    it("verifies all canonical pulse outcomes", () => {
      for (const outcome of PULSE_OUTCOMES) {
        expect(isPulseOutcome(outcome)).toBe(true);
      }
      expect(isPulseOutcome("unknown_outcome")).toBe(false);
      expect(isPulseOutcome("")).toBe(false);
    });

    it("identifies terminal outcomes accurately", () => {
      for (const outcome of TERMINAL_OUTCOMES) {
        expect(isTerminalOutcome(outcome)).toBe(true);
      }
      expect(isTerminalOutcome("advance_dispatched")).toBe(false);
      expect(isTerminalOutcome("quiescent")).toBe(false);
    });
  });

  describe("parseDuration", () => {
    it("returns numeric values directly", () => {
      expect(parseDuration(0)).toBe(0);
      expect(parseDuration(1500)).toBe(1500);
    });

    it("throws HarnessError on negative numbers or NaN", () => {
      expect(() => parseDuration(-10)).toThrow(HarnessError);
      expect(() => parseDuration(Number.NaN)).toThrow(HarnessError);
    });

    it("throws HarnessError on empty, whitespace, or invalid string formats", () => {
      expect(() => parseDuration("")).toThrow(HarnessError);
      expect(() => parseDuration("   ")).toThrow(HarnessError);
      expect(() => parseDuration("invalid-format")).toThrow(HarnessError);
      expect(() => parseDuration("10xyz")).toThrow(HarnessError);
    });

    it("parses valid time unit abbreviations accurately", () => {
      expect(parseDuration("500ms")).toBe(500);
      expect(parseDuration("5s")).toBe(5000);
      expect(parseDuration("2m")).toBe(120000);
      expect(parseDuration("1.5h")).toBe(5400000);
      expect(parseDuration("1d")).toBe(86400000);
      expect(parseDuration("350")).toBe(350);
    });
  });

  describe("Quiescent Backoff & Wake Interval Calculations", () => {
    it("returns base interval when streak is zero or negative", () => {
      expect(calculateQuiescentBackoffInterval(1000, 10000, 0)).toBe(1000);
      expect(calculateQuiescentBackoffInterval(1000, 10000, -1)).toBe(1000);
    });

    it("scales interval exponentially with streak and clamps at maximum", () => {
      const step1 = calculateQuiescentBackoffInterval(1000, 10000, 1);
      expect(step1).toBe(1500);

      const step2 = calculateQuiescentBackoffInterval(1000, 10000, 2);
      expect(step2).toBe(2250);

      const clamped = calculateQuiescentBackoffInterval(1000, 5000, 10);
      expect(clamped).toBe(5000);
    });

    it("calculates next wake interval forwarding through lifecycle throttle", () => {
      const activeResult = calculateNextWakeInterval({
        baseIntervalMs: 1000,
        maxIntervalMs: 5000,
        zeroValueStreak: 0,
        value: 1,
        applyJitter: false,
      });
      expect(activeResult.intervalMs).toBe(1000);
      expect(activeResult.isTerminal).toBe(false);
      expect(activeResult.zeroValueStreak).toBe(0);

      const terminalResult = calculateNextWakeInterval({
        baseIntervalMs: 1000,
        maxIntervalMs: 5000,
        zeroValueStreak: 2,
        value: 0,
        outcome: "halted",
      });
      expect(terminalResult.isTerminal).toBe(true);
      expect(terminalResult.intervalMs).toBeNull();
    });
  });
});
