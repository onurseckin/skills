import { describe, expect, it } from "bun:test";
import {
  PULSE_OUTCOMES,
  TERMINAL_OUTCOMES,
  calculateThrottleInterval,
  isPulseOutcome,
  isTerminalOutcome,
} from "../../../../olt/scripts/src/mind/lifecycle/interval/types.ts";

describe("Mind Lifecycle Interval Types & Throttling Suite (types.ts)", () => {
  describe("Outcome Guards & Constants", () => {
    it("recognizes all standard pulse outcomes and rejects unknown values", () => {
      for (const outcome of PULSE_OUTCOMES) {
        expect(isPulseOutcome(outcome)).toBe(true);
      }
      expect(isPulseOutcome("unknown_status")).toBe(false);
      expect(isPulseOutcome("")).toBe(false);
    });

    it("recognizes terminal outcomes and rejects non-terminal ones", () => {
      for (const outcome of TERMINAL_OUTCOMES) {
        expect(isTerminalOutcome(outcome)).toBe(true);
      }
      expect(isTerminalOutcome("quiescent")).toBe(false);
      expect(isTerminalOutcome("advance_dispatched")).toBe(false);
      expect(isTerminalOutcome("non_terminal")).toBe(false);
    });
  });

  describe("calculateThrottleInterval", () => {
    it("returns null interval on terminal outcomes", () => {
      const resHalted = calculateThrottleInterval({
        baseIntervalMs: 1000,
        maxIntervalMs: 10000,
        zeroValueStreak: 3,
        value: 0,
        outcome: "halted",
      });
      expect(resHalted.isTerminal).toBe(true);
      expect(resHalted.intervalMs).toBeNull();
      expect(resHalted.rawIntervalMs).toBeNull();
      expect(resHalted.zeroValueStreak).toBe(0);

      const resUnarmed = calculateThrottleInterval({
        baseIntervalMs: 1000,
        maxIntervalMs: 10000,
        zeroValueStreak: 2,
        value: 5,
        outcome: "unarmed",
      });
      expect(resUnarmed.isTerminal).toBe(true);
    });

    it("handles rate limited signals with backoff doubling and capping", () => {
      const resRateLimit = calculateThrottleInterval({
        baseIntervalMs: 1000,
        maxIntervalMs: 10000,
        maxPauseIntervalMs: 8000,
        previousIntervalMs: 3000,
        zeroValueStreak: 1,
        value: 0,
        signal: "rate_limit",
        applyJitter: false,
      });
      expect(resRateLimit.isRateLimited).toBe(true);
      expect(resRateLimit.rawIntervalMs).toBe(6000);
      expect(resRateLimit.intervalMs).toBe(6000);
      expect(resRateLimit.zeroValueStreak).toBe(2);
      expect(resRateLimit.isReset).toBe(false);

      // Capped by maxPauseIntervalMs
      const resCapped = calculateThrottleInterval({
        baseIntervalMs: 1000,
        maxIntervalMs: 10000,
        maxPauseIntervalMs: 5000,
        previousIntervalMs: 4000,
        zeroValueStreak: 1,
        value: 0,
        outcome: "paused",
        applyJitter: false,
      });
      expect(resCapped.rawIntervalMs).toBe(5000);

      // Falls back to baseIntervalMs when previousIntervalMs <= 0 or omitted
      const resFallbackPrev = calculateThrottleInterval({
        baseIntervalMs: 1000,
        maxIntervalMs: 10000,
        zeroValueStreak: 0,
        value: 10,
        signal: "rate_limit",
        applyJitter: false,
      });
      expect(resFallbackPrev.rawIntervalMs).toBe(2000);
      expect(resFallbackPrev.zeroValueStreak).toBe(0);
    });

    it("resets interval when positive value is produced", () => {
      const res = calculateThrottleInterval({
        baseIntervalMs: 2000,
        maxIntervalMs: 20000,
        zeroValueStreak: 4,
        value: 12,
        applyJitter: false,
      });
      expect(res.isReset).toBe(true);
      expect(res.rawIntervalMs).toBe(2000);
      expect(res.intervalMs).toBe(2000);
      expect(res.zeroValueStreak).toBe(0);
      expect(res.isTerminal).toBe(false);
      expect(res.isRateLimited).toBe(false);
    });

    it("applies exponential backoff on zero value streak", () => {
      const res = calculateThrottleInterval({
        baseIntervalMs: 1000,
        maxIntervalMs: 10000,
        zeroValueStreak: 2,
        value: 0,
        applyJitter: false,
      });
      expect(res.isReset).toBe(false);
      expect(res.zeroValueStreak).toBe(3);
      expect(res.rawIntervalMs).toBeGreaterThan(1000);
      expect(res.rawIntervalMs).toBeLessThanOrEqual(10000);
    });

    it("applies deterministic jitter when enabled", () => {
      const fixedRandom = () => 0.5;
      const resJitter = calculateThrottleInterval({
        baseIntervalMs: 5000,
        maxIntervalMs: 30000,
        zeroValueStreak: 0,
        value: 10,
        applyJitter: true,
        random: fixedRandom,
        jitterRatio: 0.1,
      });
      expect(resJitter.intervalMs).not.toBeNull();
      expect(resJitter.rawIntervalMs).toBe(5000);
      // With random 0.5, jitter is center-scaled
      expect(typeof resJitter.intervalMs).toBe("number");
    });
  });
});
