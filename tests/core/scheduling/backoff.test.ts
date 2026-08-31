import { describe, it, expect } from "bun:test";
import {
  calculateBackoffWithStrategy,
  calculateExponentialBackoff,
  projectIntervalProgression,
  QUIESCENCE_INTERVAL_MULTIPLIER,
} from "../../../olt/scripts/src/core/scheduling/index.ts";

describe("backoff", () => {
  describe("calculateExponentialBackoff", () => {
    it("computes base interval for streak 0", () => {
      expect(calculateExponentialBackoff(1000, 10000, 0)).toBe(1000);
    });

    it("treats negative streaks safely as 0", () => {
      expect(calculateExponentialBackoff(1000, 10000, -5)).toBe(1000);
    });

    it("multiplies exponentially by default factor 1.5", () => {
      const base = 1000;
      const max = 100000;
      expect(calculateExponentialBackoff(base, max, 1)).toBe(1500);
      expect(calculateExponentialBackoff(base, max, 2)).toBe(2250);
      expect(calculateExponentialBackoff(base, max, 3)).toBe(3375);
      expect(calculateExponentialBackoff(base, max, 4)).toBe(5063);
    });

    it("clamps result to maxIntervalMs", () => {
      expect(calculateExponentialBackoff(1000, 2000, 5)).toBe(2000);
    });

    it("supports custom backoff multipliers", () => {
      const base = 1000;
      const max = 50000;
      expect(calculateExponentialBackoff(base, max, 1, 2.0)).toBe(2000);
      expect(calculateExponentialBackoff(base, max, 2, 2.0)).toBe(4000);
      expect(calculateExponentialBackoff(base, max, 3, 2.0)).toBe(8000);
    });
  });

  describe("calculateBackoffWithStrategy", () => {
    it("handles immediate strategy returning 0", () => {
      expect(
        calculateBackoffWithStrategy({
          baseIntervalMs: 5000,
          maxIntervalMs: 20000,
          streak: 3,
          strategy: "immediate",
        }),
      ).toBe(0);
    });

    it("handles fixed strategy returning base interval capped at max", () => {
      expect(
        calculateBackoffWithStrategy({
          baseIntervalMs: 5000,
          maxIntervalMs: 20000,
          streak: 4,
          strategy: "fixed",
        }),
      ).toBe(5000);
      expect(
        calculateBackoffWithStrategy({
          baseIntervalMs: 25000,
          maxIntervalMs: 20000,
          streak: 4,
          strategy: "fixed",
        }),
      ).toBe(20000);
    });

    it("handles linear strategy: base * (1 + streak)", () => {
      const base = 1000;
      const max = 10000;
      expect(
        calculateBackoffWithStrategy({
          baseIntervalMs: base,
          maxIntervalMs: max,
          streak: 0,
          strategy: "linear",
        }),
      ).toBe(1000);
      expect(
        calculateBackoffWithStrategy({
          baseIntervalMs: base,
          maxIntervalMs: max,
          streak: 1,
          strategy: "linear",
        }),
      ).toBe(2000);
      expect(
        calculateBackoffWithStrategy({
          baseIntervalMs: base,
          maxIntervalMs: max,
          streak: 2,
          strategy: "linear",
        }),
      ).toBe(3000);
      expect(
        calculateBackoffWithStrategy({
          baseIntervalMs: base,
          maxIntervalMs: max,
          streak: 15,
          strategy: "linear",
        }),
      ).toBe(10000);
    });

    it("handles fibonacci strategy: base * fib(streak + 1)", () => {
      const base = 100;
      const max = 10000;
      expect(
        calculateBackoffWithStrategy({
          baseIntervalMs: base,
          maxIntervalMs: max,
          streak: 0,
          strategy: "fibonacci",
        }),
      ).toBe(100);
      expect(
        calculateBackoffWithStrategy({
          baseIntervalMs: base,
          maxIntervalMs: max,
          streak: 1,
          strategy: "fibonacci",
        }),
      ).toBe(100);
      expect(
        calculateBackoffWithStrategy({
          baseIntervalMs: base,
          maxIntervalMs: max,
          streak: 2,
          strategy: "fibonacci",
        }),
      ).toBe(200);
      expect(
        calculateBackoffWithStrategy({
          baseIntervalMs: base,
          maxIntervalMs: max,
          streak: 3,
          strategy: "fibonacci",
        }),
      ).toBe(300);
      expect(
        calculateBackoffWithStrategy({
          baseIntervalMs: base,
          maxIntervalMs: max,
          streak: 4,
          strategy: "fibonacci",
        }),
      ).toBe(500);
      expect(
        calculateBackoffWithStrategy({
          baseIntervalMs: base,
          maxIntervalMs: max,
          streak: 5,
          strategy: "fibonacci",
        }),
      ).toBe(800);
    });

    it("defaults to exponential strategy with multiplier 1.5", () => {
      const res = calculateBackoffWithStrategy({
        baseIntervalMs: 1000,
        maxIntervalMs: 10000,
        streak: 2,
      });
      expect(res).toBe(2250);
    });
  });

  describe("projectIntervalProgression", () => {
    it("returns empty array when steps <= 0", () => {
      expect(
        projectIntervalProgression({ baseIntervalMs: 1000, maxIntervalMs: 10000, steps: 0 }),
      ).toEqual([]);
      expect(
        projectIntervalProgression({ baseIntervalMs: 1000, maxIntervalMs: 10000, steps: -2 }),
      ).toEqual([]);
    });

    it("projects exponential interval sequence over N steps", () => {
      const progression = projectIntervalProgression({
        baseIntervalMs: 1000,
        maxIntervalMs: 5000,
        steps: 5,
        multiplier: 2.0,
        strategy: "exponential",
      });
      expect(progression).toEqual([1000, 2000, 4000, 5000, 5000]);
    });

    it("projects linear interval sequence over N steps", () => {
      const progression = projectIntervalProgression({
        baseIntervalMs: 1000,
        maxIntervalMs: 3500,
        steps: 4,
        strategy: "linear",
      });
      expect(progression).toEqual([1000, 2000, 3000, 3500]);
    });
  });
});
