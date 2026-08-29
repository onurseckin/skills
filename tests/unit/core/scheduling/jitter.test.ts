import { describe, it, expect } from "bun:test";
import {
  applyIntervalJitter,
  calculateDeterministicInterval,
  createCompositeSeed,
  createDeterministicRandom,
  fnv1a32,
  DEFAULT_JITTER_RATIO,
  DEFAULT_MAX_INTERVAL_MS,
  MAX_JITTER_RATIO,
  MIN_INTERVAL_MS,
  MIN_JITTER_RATIO,
} from "../../../../olt/scripts/src/core/scheduling/index.ts";

describe("jitter", () => {
  describe("fnv1a32", () => {
    it("returns standard 32-bit unsigned offset basis for empty string", () => {
      const hash = fnv1a32("");
      expect(hash).toBe(2166136261);
    });

    it("produces deterministic hashes for identical inputs", () => {
      const input = "agent-123:coordinator:task-456";
      expect(fnv1a32(input)).toBe(fnv1a32(input));
    });

    it("produces different hashes for different inputs", () => {
      const h1 = fnv1a32("test-1");
      const h2 = fnv1a32("test-2");
      expect(h1).not.toBe(h2);
    });

    it("returns unsigned 32-bit integer within valid range", () => {
      const inputs = ["abc", "123", "long-string-with-special-chars-!@#$%^&*()"];
      for (const input of inputs) {
        const hash = fnv1a32(input);
        expect(hash).toBeGreaterThanOrEqual(0);
        expect(hash).toBeLessThanOrEqual(4294967295);
        expect(Number.isInteger(hash)).toBe(true);
      }
    });
  });

  describe("createCompositeSeed", () => {
    it("creates deterministic seed with default empty options", () => {
      const s1 = createCompositeSeed();
      const s2 = createCompositeSeed({});
      expect(s1).toBe(s2);
      expect(typeof s1).toBe("number");
    });

    it("generates distinct seeds for varying agentId, role, taskId, salt, iteration, timestamp", () => {
      const base = {
        agentId: "agent-1",
        role: "implementer",
        taskId: "task-1",
        salt: "salt-a",
        iteration: 1,
        timestamp: 1700000000000,
      };
      const seedBase = createCompositeSeed(base);

      expect(createCompositeSeed({ ...base, agentId: "agent-2" })).not.toBe(seedBase);
      expect(createCompositeSeed({ ...base, role: "validator" })).not.toBe(seedBase);
      expect(createCompositeSeed({ ...base, taskId: "task-2" })).not.toBe(seedBase);
      expect(createCompositeSeed({ ...base, salt: "salt-b" })).not.toBe(seedBase);
      expect(createCompositeSeed({ ...base, iteration: 2 })).not.toBe(seedBase);
      expect(createCompositeSeed({ ...base, timestamp: 1700000001000 })).not.toBe(seedBase);
    });

    it("handles Date instances for timestamp", () => {
      const d = new Date("2026-08-29T12:00:00Z");
      const s1 = createCompositeSeed({ timestamp: d });
      const s2 = createCompositeSeed({ timestamp: d.getTime() });
      expect(s1).toBe(s2);
    });
  });

  describe("createDeterministicRandom", () => {
    it("produces values strictly in range [0, 1)", () => {
      const prng = createDeterministicRandom(12345);
      for (let i = 0; i < 100; i++) {
        const val = prng();
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThan(1);
      }
    });

    it("generates identical sequence from the same seed", () => {
      const prng1 = createDeterministicRandom(42);
      const prng2 = createDeterministicRandom(42);
      const seq1 = Array.from({ length: 10 }, () => prng1());
      const seq2 = Array.from({ length: 10 }, () => prng2());
      expect(seq1).toEqual(seq2);
    });

    it("generates different sequence from different seeds", () => {
      const prng1 = createDeterministicRandom(42);
      const prng2 = createDeterministicRandom(99);
      const seq1 = Array.from({ length: 10 }, () => prng1());
      const seq2 = Array.from({ length: 10 }, () => prng2());
      expect(seq1).not.toEqual(seq2);
    });
  });

  describe("applyIntervalJitter", () => {
    it("handles non-positive raw intervals by returning Math.max(0, raw)", () => {
      expect(applyIntervalJitter(0)).toBe(0);
      expect(applyIntervalJitter(-500)).toBe(0);
    });

    it("applies deterministic jitter within expected ratio bounds", () => {
      const raw = 10000;
      const minVal = applyIntervalJitter(raw, {
        random: () => 0,
        jitterRatio: DEFAULT_JITTER_RATIO,
      });
      const midVal = applyIntervalJitter(raw, {
        random: () => 0.5,
        jitterRatio: DEFAULT_JITTER_RATIO,
      });
      const maxVal = applyIntervalJitter(raw, {
        random: () => 1,
        jitterRatio: DEFAULT_JITTER_RATIO,
      });

      expect(minVal).toBe(Math.round(raw * (1 - DEFAULT_JITTER_RATIO)));
      expect(midVal).toBe(raw);
      expect(maxVal).toBe(Math.round(raw * (1 + DEFAULT_JITTER_RATIO)));
    });

    it("clamps jitter ratio within [minRatio, maxRatio]", () => {
      const raw = 10000;
      const underRatio = applyIntervalJitter(raw, {
        jitterRatio: 0.01,
        random: () => 1,
      });
      expect(underRatio).toBe(Math.round(raw * (1 + MIN_JITTER_RATIO)));

      const overRatio = applyIntervalJitter(raw, {
        jitterRatio: 0.99,
        random: () => 1,
      });
      expect(overRatio).toBe(Math.round(raw * (1 + MAX_JITTER_RATIO)));
    });

    it("respects custom minIntervalMs and maxIntervalMs clamps", () => {
      const clampedLow = applyIntervalJitter(100, {
        minIntervalMs: 500,
        random: () => 0,
      });
      expect(clampedLow).toBe(500);

      const clampedHigh = applyIntervalJitter(20000, {
        maxIntervalMs: 15000,
        random: () => 1,
      });
      expect(clampedHigh).toBe(15000);
    });
  });

  describe("calculateDeterministicInterval", () => {
    it("computes reproducible intervals with deterministic seed", () => {
      const raw = 60000;
      const seed = 987654;
      const val1 = calculateDeterministicInterval(raw, seed);
      const val2 = calculateDeterministicInterval(raw, seed);
      expect(val1).toBe(val2);
    });

    it("produces distinct intervals for different seeds", () => {
      const raw = 60000;
      const val1 = calculateDeterministicInterval(raw, 100);
      const val2 = calculateDeterministicInterval(raw, 200);
      expect(val1).not.toBe(val2);
    });
  });
});
