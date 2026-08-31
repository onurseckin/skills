import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AutonomicWatchdog,
  DEFAULT_ADAPTIVE_ACTIVITY_BOOST,
  DEFAULT_ADAPTIVE_BACKOFF_FACTOR,
  DEFAULT_ADAPTIVE_MAX_INTERVAL_MS,
  DEFAULT_ADAPTIVE_MIN_INTERVAL_MS,
  DEFAULT_WATCHDOG_HEARTBEAT_INTERVAL_MS,
  type AdaptiveTimerState,
  type ReactiveEvent,
  type WatchdogEvent,
} from "../../../olt/scripts/src/watchdog/index.ts";

describe("REMED-008: Immediate Reactive Wakeups upon Event Arrival", () => {
  it("immediately awakens watchdog and executes tick on string or structured event notification", async () => {
    const watchdog = new AutonomicWatchdog({ heartbeatIntervalMs: 180_000, timeoutMs: 360_000 });
    const now = 1700000000000;
    expect(watchdog.getTickCount()).toBe(0);

    const tick1 = await watchdog.notifyEvent("task_state_changed", now);
    expect(watchdog.getTickCount()).toBe(1);
    expect(tick1.tickCount).toBe(1);
    expect(tick1.health.healthy).toBe(true);

    watchdog.registerSubagent(
      { agentId: "impl-reactive-01", role: "implementer", taskId: "task-008" },
      now,
    );
    watchdog.recordWhoami("impl-reactive-01", now);
    watchdog.recordDoctor("impl-reactive-01", now);

    const reactiveEvent: ReactiveEvent = {
      type: "task_completed",
      source: "subagent_runner",
      agentId: "impl-reactive-01",
      taskId: "task-008",
      payload: { exitCode: 0, filesModified: 3 },
    };
    const tick2 = await watchdog.notifyEvent(reactiveEvent, now + 100_000);
    expect(tick2.tickCount).toBe(2);
    expect(tick2.health.healthy).toBe(true);
    expect(tick2.health.stalledAgentsCount).toBe(0);
  });

  it("executes triggerReactiveWakeup with default, string, or object reasons", async () => {
    const wakeupEvents: WatchdogEvent[] = [];
    const callbackTriggers: ReactiveEvent[] = [];
    const watchdog = new AutonomicWatchdog({
      heartbeatIntervalMs: 180_000,
      onReactiveWakeup: (trigger) => {
        callbackTriggers.push(trigger);
      },
    });
    watchdog.on("reactive_wakeup", (e) => {
      wakeupEvents.push(e as WatchdogEvent);
    });
    const now = 1700000000000;

    const tick1 = await watchdog.triggerReactiveWakeup(undefined, now);
    expect(tick1.tickCount).toBe(1);
    expect(wakeupEvents.length).toBe(1);
    expect(callbackTriggers[0]?.type).toBe("reactive_wakeup");

    const tick2 = await watchdog.triggerReactiveWakeup("agent_checkpoint", now + 10_000);
    expect(tick2.tickCount).toBe(2);
    expect(wakeupEvents.length).toBe(2);
    expect(callbackTriggers[1]?.type).toBe("agent_checkpoint");

    const tick3 = await watchdog.triggerReactiveWakeup(
      { type: "subagent_spawned", agentId: "agent-02", taskId: "task-02" },
      now + 20_000,
    );
    expect(tick3.tickCount).toBe(3);
    expect(wakeupEvents.length).toBe(3);
    expect(callbackTriggers[2]?.type).toBe("subagent_spawned");
  });

  it("reschedules running timer when reactive wakeup is triggered during active monitoring", async () => {
    const watchdog = new AutonomicWatchdog({
      heartbeatIntervalMs: 50,
      minIntervalMs: 10,
      maxIntervalMs: 100,
    });
    watchdog.start();
    expect(watchdog.isRunning()).toBe(true);

    const tick = await watchdog.triggerReactiveWakeup("manual_burst");
    expect(tick.tickCount).toBeGreaterThanOrEqual(1);
    expect(watchdog.isRunning()).toBe(true);

    watchdog.stop();
    expect(watchdog.isRunning()).toBe(false);
  });
});

describe("REMED-008: Adaptive Timers & Dynamic Cadence Adjustments", () => {
  it("initializes with default adaptive parameters and bounds", () => {
    const watchdog = new AutonomicWatchdog();
    expect(watchdog.heartbeatIntervalMs).toBe(DEFAULT_WATCHDOG_HEARTBEAT_INTERVAL_MS);
    expect(watchdog.minIntervalMs).toBe(DEFAULT_ADAPTIVE_MIN_INTERVAL_MS);
    expect(watchdog.maxIntervalMs).toBe(DEFAULT_ADAPTIVE_MAX_INTERVAL_MS);
    expect(watchdog.backoffFactor).toBe(DEFAULT_ADAPTIVE_BACKOFF_FACTOR);
    expect(watchdog.activityBoost).toBe(DEFAULT_ADAPTIVE_ACTIVITY_BOOST);
    expect(watchdog.isAdaptive()).toBe(true);
    expect(watchdog.currentIntervalMs).toBe(DEFAULT_WATCHDOG_HEARTBEAT_INTERVAL_MS);
  });

  it("accelerates / boosts on activity bursts and decays on idle periods within bounds", () => {
    const boostWd = new AutonomicWatchdog({
      heartbeatIntervalMs: 160_000,
      minIntervalMs: 10_000,
      maxIntervalMs: 160_000,
      activityBoost: 0.5,
    });
    expect(boostWd.getCurrentIntervalMs()).toBe(160_000);
    expect(boostWd.boostActivity()).toBe(80_000);
    expect(boostWd.boostActivity()).toBe(40_000);
    expect(boostWd.boostActivity()).toBe(20_000);
    expect(boostWd.boostActivity()).toBe(10_000);
    expect(boostWd.boostActivity()).toBe(10_000); // Clamped at min

    const decayWd = new AutonomicWatchdog({
      heartbeatIntervalMs: 10_000,
      minIntervalMs: 10_000,
      maxIntervalMs: 80_000,
      backoffFactor: 2.0,
    });
    expect(decayWd.decayIdle()).toBe(20_000);
    expect(decayWd.decayIdle()).toBe(40_000);
    expect(decayWd.decayIdle()).toBe(80_000);
    expect(decayWd.decayIdle()).toBe(80_000); // Clamped at max
  });

  it("automatically boosts interval on reactive wakeups and decays on idle ticks", async () => {
    const watchdog = new AutonomicWatchdog({
      heartbeatIntervalMs: 100_000,
      minIntervalMs: 10_000,
      maxIntervalMs: 100_000,
      activityBoost: 0.5,
      backoffFactor: 1.5,
    });
    const now = 1700000000000;
    const tick1 = await watchdog.notifyEvent("task_started", now);
    expect(tick1.intervalMs).toBe(50_000);
    expect(watchdog.currentIntervalMs).toBe(50_000);

    const tick2 = await watchdog.notifyEvent("task_progress", now + 1_000);
    expect(tick2.intervalMs).toBe(25_000);
    expect(watchdog.currentIntervalMs).toBe(25_000);

    const tick3 = await watchdog.tick(now + 26_000);
    expect(tick3.intervalMs).toBe(37_500);
    expect(watchdog.currentIntervalMs).toBe(37_500);

    const tick4 = await watchdog.tick(now + 64_000);
    expect(tick4.intervalMs).toBe(56_250);
    expect(watchdog.currentIntervalMs).toBe(56_250);
  });

  it("supports reconfiguration, resetInterval, snapshots, disabling, and callbacks", () => {
    const adjustedStates: AdaptiveTimerState[] = [];
    const watchdog = new AutonomicWatchdog({
      heartbeatIntervalMs: 60_000,
      minIntervalMs: 5_000,
      maxIntervalMs: 120_000,
      activityBoost: 0.5,
      onIntervalAdjusted: (state) => {
        adjustedStates.push(state);
      },
    });

    watchdog.configureAdaptiveTimers({
      minIntervalMs: 2_000,
      maxIntervalMs: 120_000,
      backoffFactor: 1.8,
      activityBoost: 0.4,
    });
    expect(watchdog.minIntervalMs).toBe(2_000);
    expect(watchdog.maxIntervalMs).toBe(120_000);

    watchdog.setAdaptiveBounds({ minIntervalMs: 1_000, maxIntervalMs: 50_000 });
    expect(watchdog.minIntervalMs).toBe(1_000);
    expect(watchdog.maxIntervalMs).toBe(50_000);

    watchdog.configureAdaptiveTimers({ minIntervalMs: 90_000, maxIntervalMs: 30_000 }); // swapped bounds
    expect(watchdog.minIntervalMs).toBe(30_000);
    expect(watchdog.maxIntervalMs).toBe(90_000);

    watchdog.boostActivity(0.5);
    expect(adjustedStates.length).toBe(1);
    watchdog.resetInterval();
    expect(watchdog.currentIntervalMs).toBe(60_000);
    watchdog.resetInterval(90_000);
    expect(watchdog.currentIntervalMs).toBe(90_000);

    const state = watchdog.getAdaptiveState();
    expect(state.enabled).toBe(true);
    expect(state.minIntervalMs).toBe(30_000);

    const nonAdaptive = new AutonomicWatchdog({ heartbeatIntervalMs: 60_000, adaptive: false });
    expect(nonAdaptive.isAdaptive()).toBe(false);
    nonAdaptive.boostActivity(0.5);
    expect(nonAdaptive.currentIntervalMs).toBe(60_000);
  });
});

describe("REMED-008: Event Bus Listener Registration & Invocation", () => {
  it("registers listeners for specific event types and wildcard '*'", async () => {
    const watchdog = new AutonomicWatchdog({ heartbeatIntervalMs: 180_000 });
    const specificEvents: WatchdogEvent[] = [];
    const wildcardEvents: WatchdogEvent[] = [];
    const taskCompletedEvents: ReactiveEvent[] = [];

    watchdog.on("reactive_wakeup", (e) => {
      specificEvents.push(e as WatchdogEvent);
    });
    watchdog.on("*", (e) => {
      wildcardEvents.push(e as WatchdogEvent);
    });
    watchdog.on("task_completed", (e) => {
      taskCompletedEvents.push(e as ReactiveEvent);
    });

    const now = 1700000000000;
    await watchdog.notifyEvent(
      { type: "task_completed", taskId: "task-remed-008", agentId: "agent-008" },
      now,
    );

    expect(specificEvents.length).toBe(1);
    expect(specificEvents[0]?.type).toBe("reactive_wakeup");
    expect(taskCompletedEvents.length).toBe(1);
    expect(taskCompletedEvents[0]?.type).toBe("task_completed");
    expect(wildcardEvents.length).toBeGreaterThanOrEqual(3);
  });

  it("unregisters listeners cleanly, emits custom events, handles errors, and disposes cleanly", async () => {
    const watchdog = new AutonomicWatchdog({ heartbeatIntervalMs: 180_000 });
    let count1 = 0;
    let count2 = 0;
    const unsub1 = watchdog.on("tick", () => {
      count1++;
    });
    const listener2 = (): void => {
      count2++;
    };
    watchdog.addEventListener("tick", listener2);

    await watchdog.tick();
    expect(count1).toBe(1);
    expect(count2).toBe(1);

    unsub1();
    watchdog.removeEventListener("tick", listener2);
    await watchdog.tick();
    expect(count1).toBe(1);
    expect(count2).toBe(1);

    const customEvents: ReactiveEvent[] = [];
    watchdog.on("agent_heartbeat_boost", (e) => {
      customEvents.push(e as ReactiveEvent);
    });
    watchdog.emitCustomEvent({
      type: "agent_heartbeat_boost",
      agentId: "worker-01",
      payload: { priority: "high" },
    });
    expect(customEvents[0]?.agentId).toBe("worker-01");

    watchdog.on("tick", () => {
      throw new Error("Simulated listener crash");
    });
    let safeCalled = false;
    watchdog.on("tick", () => {
      safeCalled = true;
    });
    const tick = await watchdog.tick();
    expect(tick.tickCount).toBe(3);
    expect(safeCalled).toBe(true);

    watchdog.start();
    expect(watchdog.isRunning()).toBe(true);
    watchdog.dispose();
    expect(watchdog.isRunning()).toBe(false);
  });
});

describe("REMED-008: Invariants & Cleanliness Audit", () => {
  it("enforces zero TypeScript any and zero suppression directives across all watchdog files", () => {
    const watchdogDir = join(__dirname, "../../../olt/scripts/src/watchdog");
    const autoDir = join(watchdogDir, "autonomic-watchdog");
    const bootDir = join(watchdogDir, "boot-gate-enforcer");
    const sourceFiles = [
      join(watchdogDir, "constants.ts"),
      join(watchdogDir, "types.ts"),
      join(watchdogDir, "index.ts"),
      join(autoDir, "activity-tracker.ts"),
      join(autoDir, "adaptive-timer.ts"),
      join(autoDir, "cli-reporter.ts"),
      join(autoDir, "event-emitter.ts"),
      join(autoDir, "health-auditor.ts"),
      join(autoDir, "reactive-dispatcher.ts"),
      join(autoDir, "types.ts"),
      join(autoDir, "watchdog-engine.ts"),
      join(autoDir, "index.ts"),
      join(bootDir, "enforcer.ts"),
      join(bootDir, "formatter.ts"),
      join(bootDir, "recorder.ts"),
      join(bootDir, "state-auditor.ts"),
      join(bootDir, "types.ts"),
      join(bootDir, "verifier.ts"),
      join(bootDir, "index.ts"),
      __filename,
    ];
    for (const filePath of sourceFiles) {
      const c = readFileSync(filePath, "utf8");
      expect(c).not.toMatch(new RegExp(":\\s*any\\b|as\\s+any\\b|<\\s*any\\s*>"));
      expect(
        c.includes("@" + "ts-ignore") ||
          c.includes("@" + "ts-expect-error") ||
          c.includes("@" + "ts-nocheck"),
      ).toBe(false);
      expect(c.includes("eslint" + "-disable") || c.includes("oxlint" + "-disable")).toBe(false);
    }
  });
});
