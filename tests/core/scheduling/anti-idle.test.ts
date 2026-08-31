import { describe, it, expect } from "bun:test";
import {
  computeAntiIdleInterval,
  DEFAULT_BASE_INTERVAL_MS,
  DEFAULT_MAX_INTERVAL_MS,
  DEFAULT_MAX_PAUSE_INTERVAL_MS,
} from "../../../olt/scripts/src/core/scheduling/index.ts";

describe("anti-idle", () => {
  describe("computeAntiIdleInterval", () => {
    it("returns immediate rollover when hasPendingWork is true", () => {
      const res = computeAntiIdleInterval({
        hasPendingWork: true,
        zeroValueStreak: 5,
      });
      expect(res.isImmediate).toBe(true);
      expect(res.intervalMs).toBe(0);
      expect(res.rawIntervalMs).toBe(0);
      expect(res.zeroValueStreak).toBe(0);
      expect(res.reason).toContain("Immediate rollover");
    });

    it("returns immediate rollover when active is true", () => {
      const res = computeAntiIdleInterval({
        active: true,
        zeroValueStreak: 3,
      });
      expect(res.isImmediate).toBe(true);
      expect(res.intervalMs).toBe(0);
      expect(res.zeroValueStreak).toBe(0);
    });

    it("handles retryAfterMs directive without jitter", () => {
      const res = computeAntiIdleInterval({
        retryAfterMs: 30000,
        zeroValueStreak: 2,
        applyJitter: false,
      });
      expect(res.isImmediate).toBe(false);
      expect(res.intervalMs).toBe(30000);
      expect(res.rawIntervalMs).toBe(30000);
      expect(res.zeroValueStreak).toBe(3);
      expect(res.reason).toContain("Retry-After");
    });

    it("handles retryAfterMs with jitter applied", () => {
      const res = computeAntiIdleInterval({
        retryAfterMs: 30000,
        zeroValueStreak: 1,
        applyJitter: true,
        random: () => 0.5,
      });
      expect(res.isImmediate).toBe(false);
      expect(res.rawIntervalMs).toBe(30000);
      expect(res.intervalMs).toBe(30000);
      expect(res.zeroValueStreak).toBe(2);
    });

    it("handles rate limiting doubling previous interval up to maxPauseIntervalMs", () => {
      const res = computeAntiIdleInterval({
        isRateLimited: true,
        previousIntervalMs: 2000,
        maxPauseIntervalMs: 10000,
        zeroValueStreak: 1,
        applyJitter: false,
      });
      expect(res.isImmediate).toBe(false);
      expect(res.rawIntervalMs).toBe(4000);
      expect(res.intervalMs).toBe(4000);
      expect(res.zeroValueStreak).toBe(2);
      expect(res.reason).toContain("Rate limit backoff");
    });

    it("clamps rate limited interval to maxPauseIntervalMs", () => {
      const res = computeAntiIdleInterval({
        isRateLimited: true,
        previousIntervalMs: 50000,
        maxPauseIntervalMs: 60000,
        zeroValueStreak: 2,
        applyJitter: false,
      });
      expect(res.rawIntervalMs).toBe(60000);
      expect(res.intervalMs).toBe(60000);
    });

    it("falls back to baseIntervalMs when previousIntervalMs is absent on rate limit", () => {
      const res = computeAntiIdleInterval({
        isRateLimited: true,
        baseIntervalMs: 5000,
        zeroValueStreak: 0,
        applyJitter: false,
      });
      expect(res.rawIntervalMs).toBe(10000);
      expect(res.intervalMs).toBe(10000);
    });

    it("computes quiescent exponential backoff without jitter", () => {
      const streak0 = computeAntiIdleInterval({
        baseIntervalMs: 1000,
        maxIntervalMs: 10000,
        zeroValueStreak: 0,
        applyJitter: false,
      });
      expect(streak0.isImmediate).toBe(false);
      expect(streak0.intervalMs).toBe(1000);
      expect(streak0.zeroValueStreak).toBe(0);

      const streak2 = computeAntiIdleInterval({
        baseIntervalMs: 1000,
        maxIntervalMs: 10000,
        zeroValueStreak: 2,
        applyJitter: false,
      });
      expect(streak2.intervalMs).toBe(2250);
      expect(streak2.zeroValueStreak).toBe(2);
      expect(streak2.reason).toContain("Quiescent backoff");
    });

    it("computes quiescent exponential backoff with jitter and custom multiplier", () => {
      const res = computeAntiIdleInterval({
        baseIntervalMs: 1000,
        maxIntervalMs: 50000,
        zeroValueStreak: 3,
        multiplier: 2.0,
        applyJitter: true,
        random: () => 0.5,
      });
      expect(res.rawIntervalMs).toBe(8000);
      expect(res.intervalMs).toBe(8000);
    });
  });
});
