import { describe, it, expect } from "bun:test";
import {
  AdaptiveTimerController,
  DEFAULT_ADAPTIVE_ACTIVITY_BOOST,
  DEFAULT_ADAPTIVE_BACKOFF_FACTOR,
  DEFAULT_ADAPTIVE_MAX_INTERVAL_MS,
  DEFAULT_ADAPTIVE_MIN_INTERVAL_MS,
  DEFAULT_WATCHDOG_HEARTBEAT_INTERVAL_MS,
} from "../../../../olt/scripts/src/core/scheduling/index.ts";

describe("adaptive-timer", () => {
  describe("AdaptiveTimerController initialization", () => {
    it("initializes with default values when config is empty", () => {
      const controller = new AdaptiveTimerController();
      expect(controller.isAdaptive()).toBe(true);
      expect(controller.minIntervalMs).toBe(DEFAULT_ADAPTIVE_MIN_INTERVAL_MS);
      expect(controller.maxIntervalMs).toBe(DEFAULT_ADAPTIVE_MAX_INTERVAL_MS);
      expect(controller.backoffFactor).toBe(DEFAULT_ADAPTIVE_BACKOFF_FACTOR);
      expect(controller.activityBoost).toBe(DEFAULT_ADAPTIVE_ACTIVITY_BOOST);
      expect(controller.currentIntervalMs).toBe(DEFAULT_WATCHDOG_HEARTBEAT_INTERVAL_MS);
    });

    it("initializes with custom parameters", () => {
      const controller = new AdaptiveTimerController({
        minIntervalMs: 5000,
        maxIntervalMs: 60000,
        backoffFactor: 2.0,
        activityBoost: 0.25,
        initialIntervalMs: 20000,
      });
      expect(controller.minIntervalMs).toBe(5000);
      expect(controller.maxIntervalMs).toBe(60000);
      expect(controller.backoffFactor).toBe(2.0);
      expect(controller.activityBoost).toBe(0.25);
      expect(controller.currentIntervalMs).toBe(20000);
    });

    it("initializes with nested adaptive configuration object", () => {
      const controller = new AdaptiveTimerController({
        adaptive: {
          enabled: true,
          minIntervalMs: 10000,
          maxIntervalMs: 120000,
          backoffFactor: 1.8,
          activityBoost: 0.4,
          initialIntervalMs: 30000,
        },
      });
      expect(controller.isAdaptive()).toBe(true);
      expect(controller.minIntervalMs).toBe(10000);
      expect(controller.maxIntervalMs).toBe(120000);
      expect(controller.backoffFactor).toBe(1.8);
      expect(controller.activityBoost).toBe(0.4);
      expect(controller.currentIntervalMs).toBe(30000);
    });

    it("handles adaptive disabled flag", () => {
      const controller = new AdaptiveTimerController({ adaptive: false });
      expect(controller.isAdaptive()).toBe(false);
    });
  });

  describe("getAdaptiveState", () => {
    it("returns consistent state snapshot", () => {
      const timestamp = new Date("2026-08-29T10:00:00Z");
      const controller = new AdaptiveTimerController(
        { minIntervalMs: 5000, maxIntervalMs: 50000, initialIntervalMs: 10000 },
        timestamp,
      );
      const state = controller.getAdaptiveState();
      expect(state.enabled).toBe(true);
      expect(state.minIntervalMs).toBe(5000);
      expect(state.maxIntervalMs).toBe(50000);
      expect(state.currentIntervalMs).toBe(10000);
      expect(state.lastAdjustmentReason).toBe("initial");
      expect(state.lastAdjustedAt).toBe(timestamp.toISOString());
    });
  });

  describe("configureAdaptiveTimers & setAdaptiveBounds", () => {
    it("updates bounds and swaps inverted min/max bounds", () => {
      const controller = new AdaptiveTimerController();
      controller.configureAdaptiveTimers({
        minIntervalMs: 500000,
        maxIntervalMs: 100000,
      });
      expect(controller.minIntervalMs).toBe(100000);
      expect(controller.maxIntervalMs).toBe(500000);
    });

    it("updates backoffFactor, activityBoost and initial interval", () => {
      const controller = new AdaptiveTimerController();
      controller.setAdaptiveBounds({
        backoffFactor: 2.5,
        activityBoost: 0.1,
        initialIntervalMs: 50000,
      });
      expect(controller.backoffFactor).toBe(2.5);
      expect(controller.activityBoost).toBe(0.1);
      expect(controller.currentIntervalMs).toBe(50000);
    });
  });

  describe("boostActivity", () => {
    it("reduces interval by activity boost and clamps to minIntervalMs", () => {
      const controller = new AdaptiveTimerController({
        minIntervalMs: 10000,
        maxIntervalMs: 100000,
        initialIntervalMs: 40000,
        activityBoost: 0.5,
      });
      const res1 = controller.boostActivity();
      expect(res1.previousIntervalMs).toBe(40000);
      expect(res1.newIntervalMs).toBe(20000);
      expect(res1.changed).toBe(true);
      expect(res1.reason).toBe("activity_burst");

      const res2 = controller.boostActivity();
      expect(res2.newIntervalMs).toBe(10000);

      const res3 = controller.boostActivity();
      expect(res3.newIntervalMs).toBe(10000);
      expect(res3.changed).toBe(false);
    });

    it("does not change interval when adaptive is disabled", () => {
      const controller = new AdaptiveTimerController({
        adaptive: false,
        initialIntervalMs: 30000,
      });
      const res = controller.boostActivity();
      expect(res.changed).toBe(false);
      expect(res.newIntervalMs).toBe(30000);
    });
  });

  describe("decayIdle", () => {
    it("increases interval by backoff factor and clamps to maxIntervalMs", () => {
      const controller = new AdaptiveTimerController({
        minIntervalMs: 10000,
        maxIntervalMs: 50000,
        initialIntervalMs: 20000,
        backoffFactor: 2.0,
      });
      const res1 = controller.decayIdle();
      expect(res1.previousIntervalMs).toBe(20000);
      expect(res1.newIntervalMs).toBe(40000);
      expect(res1.changed).toBe(true);
      expect(res1.reason).toBe("idle_backoff");

      const res2 = controller.decayIdle();
      expect(res2.newIntervalMs).toBe(50000);

      const res3 = controller.decayIdle();
      expect(res3.newIntervalMs).toBe(50000);
      expect(res3.changed).toBe(false);
    });

    it("does not change interval when adaptive is disabled", () => {
      const controller = new AdaptiveTimerController({
        adaptive: false,
        initialIntervalMs: 30000,
      });
      const res = controller.decayIdle();
      expect(res.changed).toBe(false);
      expect(res.newIntervalMs).toBe(30000);
    });
  });

  describe("resetInterval", () => {
    it("resets interval clamped within bounds and sets manual_reset reason", () => {
      const controller = new AdaptiveTimerController({
        minIntervalMs: 10000,
        maxIntervalMs: 100000,
        initialIntervalMs: 20000,
      });
      const res = controller.resetInterval(50000);
      expect(res.previousIntervalMs).toBe(20000);
      expect(res.newIntervalMs).toBe(50000);
      expect(res.changed).toBe(true);
      expect(res.reason).toBe("manual_reset");

      const resClamped = controller.resetInterval(50000, 5000);
      expect(resClamped.newIntervalMs).toBe(10000);
    });
  });
});
