import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  AdaptiveTimerController,
  type IntervalAdjustmentResult,
} from "../../../olt/scripts/src/watchdog/autonomic-watchdog/adaptive-timer.ts";
import { AutonomicWatchdog } from "../../../olt/scripts/src/watchdog/index.ts";
import { cleanupVirtualWatchdogFS, setupVirtualWatchdogFS } from "../watchdog-fixture.ts";

beforeEach(() => {
  setupVirtualWatchdogFS();
});

afterEach(() => {
  cleanupVirtualWatchdogFS();
});

describe("AdaptiveTimerController & Dynamic Scheduling", () => {
  it("initializes with default boundaries and calculates interval state", () => {
    const controller = new AdaptiveTimerController({
      minIntervalMs: 5_000,
      maxIntervalMs: 60_000,
      backoffFactor: 1.5,
      activityBoost: 0.5,
    });

    const state = controller.getAdaptiveState();
    expect(state.minIntervalMs).toBe(5_000);
    expect(state.maxIntervalMs).toBe(60_000);
    expect(state.backoffFactor).toBe(1.5);
    expect(state.activityBoost).toBe(0.5);
    expect(state.currentIntervalMs).toBe(60_000);
  });

  it("scales interval down on activity boost and clamps to minIntervalMs", () => {
    const controller = new AdaptiveTimerController({
      minIntervalMs: 10_000,
      maxIntervalMs: 80_000,
    });

    // 80,000 * 0.5 = 40,000
    const res1: IntervalAdjustmentResult = controller.boostActivity(0.5, 1700000000000);
    expect(res1.previousIntervalMs).toBe(80_000);
    expect(res1.newIntervalMs).toBe(40_000);
    expect(res1.reason).toBe("activity_burst");

    // 40,000 * 0.1 = 4,000 -> clamped to min 10,000
    const res2 = controller.boostActivity(0.1, 1700000001000);
    expect(res2.newIntervalMs).toBe(10_000);
  });

  it("scales interval up on idle decay and clamps to maxIntervalMs", () => {
    const controller = new AdaptiveTimerController({
      minIntervalMs: 10_000,
      maxIntervalMs: 50_000,
    });

    controller.boostActivity(0.2, 1700000000000); // 50,000 * 0.2 = 10,000
    expect(controller.getAdaptiveState().currentIntervalMs).toBe(10_000);

    const res1 = controller.decayIdle(1.5, 1700000001000); // 10,000 * 1.5 = 15,000
    expect(res1.newIntervalMs).toBe(15_000);

    const res2 = controller.decayIdle(4.0, 1700000002000); // 15,000 * 4.0 = 60,000 -> clamped to 50,000
    expect(res2.newIntervalMs).toBe(50_000);
  });

  it("resets interval directly to base or custom target", () => {
    const controller = new AdaptiveTimerController({
      minIntervalMs: 5_000,
      maxIntervalMs: 100_000,
    });

    controller.boostActivity(0.1, 1700000000000); // 10,000
    const resReset = controller.resetInterval(75_000, undefined, 1700000001000);
    expect(resReset.newIntervalMs).toBe(75_000);
    expect(resReset.reason).toBe("manual_reset");
  });

  it("integrates seamlessly into AutonomicWatchdog instance", () => {
    const watchdog = new AutonomicWatchdog({
      heartbeatIntervalMs: 100_000,
      minIntervalMs: 10_000,
      maxIntervalMs: 100_000,
      activityBoost: 0.5,
      backoffFactor: 1.5,
    });

    expect(watchdog.boostActivity(0.5, 1700000000000)).toBe(50_000);
    expect(watchdog.currentIntervalMs).toBe(50_000);

    expect(watchdog.decayIdle(1.5, 1700000001000)).toBe(75_000);
    expect(watchdog.currentIntervalMs).toBe(75_000);

    watchdog.resetInterval(100_000, 1700000002000);
    expect(watchdog.currentIntervalMs).toBe(100_000);

    watchdog.configureAdaptiveTimers({ minIntervalMs: 5_000, maxIntervalMs: 60_000 });
    expect(watchdog.minIntervalMs).toBe(5_000);
    expect(watchdog.maxIntervalMs).toBe(60_000);

    const state = watchdog.getAdaptiveState();
    expect(state.enabled).toBe(true);
    expect(state.minIntervalMs).toBe(5_000);
    expect(state.maxIntervalMs).toBe(60_000);
  });
});
