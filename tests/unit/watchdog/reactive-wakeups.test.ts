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
} from "../../../orchestrating-long-tasks/scripts/src/watchdog/index.ts";

describe("REMED-008: Immediate Reactive Wakeups upon Event Arrival", () => {
  it("immediately awakens watchdog and executes tick on string event notification", async () => {
    const watchdog = new AutonomicWatchdog({
      heartbeatIntervalMs: 180_000,
    });

    const now = 1700000000000;
    expect(watchdog.getTickCount()).toBe(0);

    const tick1 = await watchdog.notifyEvent("task_state_changed", now);

    expect(watchdog.getTickCount()).toBe(1);
    expect(tick1.tickCount).toBe(1);
    expect(tick1.health.healthy).toBe(true);
  });

  it("handles structured ReactiveEvent objects with actor/task metadata and updates activity", async () => {
    const watchdog = new AutonomicWatchdog({
      heartbeatIntervalMs: 180_000,
      timeoutMs: 360_000,
    });

    const startTime = 1700000000000;
    watchdog.registerSubagent(
      {
        agentId: "impl-reactive-01",
        role: "implementer",
        taskId: "task-008",
      },
      startTime,
    );
    watchdog.recordWhoami("impl-reactive-01", startTime);
    watchdog.recordDoctor("impl-reactive-01", startTime);

    const reactiveEvent: ReactiveEvent = {
      type: "task_completed",
      source: "subagent_runner",
      agentId: "impl-reactive-01",
      taskId: "task-008",
      payload: {
        exitCode: 0,
        filesModified: 3,
      },
    };

    const tick = await watchdog.notifyEvent(reactiveEvent, startTime + 100_000);

    expect(tick.tickCount).toBe(1);
    expect(tick.health.healthy).toBe(true);
    expect(tick.health.stalledAgentsCount).toBe(0);
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

    // 1. Default (no args)
    const tick1 = await watchdog.triggerReactiveWakeup(undefined, now);
    expect(tick1.tickCount).toBe(1);
    expect(wakeupEvents.length).toBe(1);
    expect(callbackTriggers.length).toBe(1);
    expect(callbackTriggers[0]?.type).toBe("reactive_wakeup");

    // 2. String reason
    const tick2 = await watchdog.triggerReactiveWakeup("agent_checkpoint", now + 10_000);
    expect(tick2.tickCount).toBe(2);
    expect(wakeupEvents.length).toBe(2);
    expect(callbackTriggers.length).toBe(2);
    expect(callbackTriggers[1]?.type).toBe("agent_checkpoint");

    // 3. Object trigger
    const tick3 = await watchdog.triggerReactiveWakeup(
      {
        type: "subagent_spawned",
        agentId: "agent-02",
        taskId: "task-02",
      },
      now + 20_000,
    );
    expect(tick3.tickCount).toBe(3);
    expect(wakeupEvents.length).toBe(3);
    expect(callbackTriggers.length).toBe(3);
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

    // Trigger reactive wakeup while running
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

  it("accelerates / boosts interval on activity bursts down to minIntervalMs", () => {
    const watchdog = new AutonomicWatchdog({
      heartbeatIntervalMs: 160_000,
      minIntervalMs: 10_000,
      maxIntervalMs: 160_000,
      activityBoost: 0.5,
    });

    expect(watchdog.getCurrentIntervalMs()).toBe(160_000);

    // 1st boost: 160_000 * 0.5 = 80_000
    const step1 = watchdog.boostActivity();
    expect(step1).toBe(80_000);
    expect(watchdog.currentIntervalMs).toBe(80_000);

    // 2nd boost: 80_000 * 0.5 = 40_000
    const step2 = watchdog.boostActivity();
    expect(step2).toBe(40_000);

    // 3rd boost: 40_000 * 0.5 = 20_000
    const step3 = watchdog.boostActivity();
    expect(step3).toBe(20_000);

    // 4th boost: 20_000 * 0.5 = 10_000 (min reached)
    const step4 = watchdog.boostActivity();
    expect(step4).toBe(10_000);

    // 5th boost: clamped at minIntervalMs = 10_000
    const step5 = watchdog.boostActivity();
    expect(step5).toBe(10_000);
  });

  it("backs off / decays interval on idle periods up to maxIntervalMs", () => {
    const watchdog = new AutonomicWatchdog({
      heartbeatIntervalMs: 10_000,
      minIntervalMs: 10_000,
      maxIntervalMs: 80_000,
      backoffFactor: 2.0,
    });

    expect(watchdog.currentIntervalMs).toBe(10_000);

    // 1st decay: 10_000 * 2 = 20_000
    const step1 = watchdog.decayIdle();
    expect(step1).toBe(20_000);

    // 2nd decay: 20_000 * 2 = 40_000
    const step2 = watchdog.decayIdle();
    expect(step2).toBe(40_000);

    // 3rd decay: 40_000 * 2 = 80_000 (max reached)
    const step3 = watchdog.decayIdle();
    expect(step3).toBe(80_000);

    // 4th decay: clamped at maxIntervalMs = 80_000
    const step4 = watchdog.decayIdle();
    expect(step4).toBe(80_000);
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

    // Reactive event triggers boost: 100_000 * 0.5 = 50_000
    const tick1 = await watchdog.notifyEvent("task_started", now);
    expect(tick1.intervalMs).toBe(50_000);
    expect(watchdog.currentIntervalMs).toBe(50_000);

    // Second reactive event boosts further: 50_000 * 0.5 = 25_000
    const tick2 = await watchdog.notifyEvent("task_progress", now + 1_000);
    expect(tick2.intervalMs).toBe(25_000);
    expect(watchdog.currentIntervalMs).toBe(25_000);

    // Idle tick (no new events, system healthy, no active leases) decays: 25_000 * 1.5 = 37_500
    const tick3 = await watchdog.tick(now + 26_000);
    expect(tick3.intervalMs).toBe(37_500);
    expect(watchdog.currentIntervalMs).toBe(37_500);

    // Subsequent idle tick decays further: 37_500 * 1.5 = 56_250
    const tick4 = await watchdog.tick(now + 64_000);
    expect(tick4.intervalMs).toBe(56_250);
    expect(watchdog.currentIntervalMs).toBe(56_250);
  });

  it("supports dynamic reconfiguration via configureAdaptiveTimers and setAdaptiveBounds", () => {
    const watchdog = new AutonomicWatchdog({
      heartbeatIntervalMs: 60_000,
    });

    watchdog.configureAdaptiveTimers({
      minIntervalMs: 2_000,
      maxIntervalMs: 120_000,
      backoffFactor: 1.8,
      activityBoost: 0.4,
    });

    expect(watchdog.minIntervalMs).toBe(2_000);
    expect(watchdog.maxIntervalMs).toBe(120_000);
    expect(watchdog.backoffFactor).toBe(1.8);
    expect(watchdog.activityBoost).toBe(0.4);

    // setAdaptiveBounds alias
    watchdog.setAdaptiveBounds({
      minIntervalMs: 1_000,
      maxIntervalMs: 50_000,
    });
    expect(watchdog.minIntervalMs).toBe(1_000);
    expect(watchdog.maxIntervalMs).toBe(50_000);

    // Handles inverted bounds by swapping
    watchdog.configureAdaptiveTimers({
      minIntervalMs: 90_000,
      maxIntervalMs: 30_000,
    });
    expect(watchdog.minIntervalMs).toBe(30_000);
    expect(watchdog.maxIntervalMs).toBe(90_000);
  });

  it("supports resetInterval to return to default or specified interval", () => {
    const watchdog = new AutonomicWatchdog({
      heartbeatIntervalMs: 60_000,
      minIntervalMs: 5_000,
      maxIntervalMs: 120_000,
    });

    watchdog.boostActivity(0.1);
    expect(watchdog.currentIntervalMs).toBe(6_000);

    watchdog.resetInterval();
    expect(watchdog.currentIntervalMs).toBe(60_000);

    watchdog.resetInterval(90_000);
    expect(watchdog.currentIntervalMs).toBe(90_000);
  });

  it("captures full adaptive state snapshots via getAdaptiveState", () => {
    const watchdog = new AutonomicWatchdog({
      heartbeatIntervalMs: 60_000,
      minIntervalMs: 5_000,
      maxIntervalMs: 120_000,
      backoffFactor: 1.5,
      activityBoost: 0.5,
    });

    const state1 = watchdog.getAdaptiveState();
    expect(state1.enabled).toBe(true);
    expect(state1.currentIntervalMs).toBe(60_000);
    expect(state1.minIntervalMs).toBe(5_000);
    expect(state1.maxIntervalMs).toBe(120_000);
    expect(state1.lastAdjustmentReason).toBe("initial");

    watchdog.boostActivity(0.5, 1700000000000, "activity_burst");
    const state2 = watchdog.getAdaptiveState();
    expect(state2.currentIntervalMs).toBe(30_000);
    expect(state2.lastAdjustmentReason).toBe("activity_burst");
  });

  it("disables adaptive adjustments when adaptive is set to false", () => {
    const watchdog = new AutonomicWatchdog({
      heartbeatIntervalMs: 60_000,
      adaptive: false,
    });

    expect(watchdog.isAdaptive()).toBe(false);
    expect(watchdog.currentIntervalMs).toBe(60_000);

    watchdog.boostActivity(0.5);
    expect(watchdog.currentIntervalMs).toBe(60_000);

    watchdog.decayIdle(2.0);
    expect(watchdog.currentIntervalMs).toBe(60_000);
  });

  it("fires onIntervalAdjusted callback when interval changes", () => {
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

    watchdog.boostActivity(0.5);
    expect(adjustedStates.length).toBe(1);
    expect(adjustedStates[0]?.currentIntervalMs).toBe(30_000);
    expect(adjustedStates[0]?.lastAdjustmentReason).toBe("activity_burst");

    watchdog.decayIdle(2.0);
    expect(adjustedStates.length).toBe(2);
    expect(adjustedStates[1]?.currentIntervalMs).toBe(60_000);
    expect(adjustedStates[1]?.lastAdjustmentReason).toBe("idle_backoff");
  });
});

describe("REMED-008: Event Bus Listener Registration & Invocation", () => {
  it("registers listeners for specific event types and wildcard '*'", async () => {
    const watchdog = new AutonomicWatchdog({
      heartbeatIntervalMs: 180_000,
    });

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
      {
        type: "task_completed",
        taskId: "task-remed-008",
        agentId: "agent-008",
      },
      now,
    );

    expect(specificEvents.length).toBe(1);
    expect(specificEvents[0]?.type).toBe("reactive_wakeup");

    expect(taskCompletedEvents.length).toBe(1);
    expect(taskCompletedEvents[0]?.type).toBe("task_completed");
    expect(taskCompletedEvents[0]?.taskId).toBe("task-remed-008");

    // Wildcard receives event_notified, interval_adjusted, health_audit, tick, and reactive_wakeup
    expect(wildcardEvents.length).toBeGreaterThanOrEqual(3);
  });

  it("unregisters listeners cleanly using return callback or off / removeEventListener", async () => {
    const watchdog = new AutonomicWatchdog({
      heartbeatIntervalMs: 180_000,
    });

    let count1 = 0;
    let count2 = 0;

    const unsubscribe1 = watchdog.on("tick", () => {
      count1++;
    });

    const listener2 = (): void => {
      count2++;
    };
    watchdog.addEventListener("tick", listener2);

    await watchdog.tick();
    expect(count1).toBe(1);
    expect(count2).toBe(1);

    // Unsubscribe 1 via returned closure
    unsubscribe1();

    // Unsubscribe 2 via removeEventListener
    watchdog.removeEventListener("tick", listener2);

    await watchdog.tick();
    expect(count1).toBe(1);
    expect(count2).toBe(1);
  });

  it("emits custom events via emitCustomEvent to event bus", () => {
    const watchdog = new AutonomicWatchdog();

    const customEvents: ReactiveEvent[] = [];
    watchdog.on("agent_heartbeat_boost", (e) => {
      customEvents.push(e as ReactiveEvent);
    });

    watchdog.emitCustomEvent({
      type: "agent_heartbeat_boost",
      agentId: "worker-01",
      payload: { priority: "high" },
    });

    expect(customEvents.length).toBe(1);
    expect(customEvents[0]?.type).toBe("agent_heartbeat_boost");
    expect(customEvents[0]?.agentId).toBe("worker-01");
  });

  it("handles listener errors gracefully without interrupting execution", async () => {
    const watchdog = new AutonomicWatchdog();

    watchdog.on("tick", () => {
      throw new Error("Simulated listener crash");
    });

    let safeListenerCalled = false;
    watchdog.on("tick", () => {
      safeListenerCalled = true;
    });

    const tick = await watchdog.tick();
    expect(tick.tickCount).toBe(1);
    expect(safeListenerCalled).toBe(true);
  });

  it("disposes watchdog and clears all event listeners and activity state", () => {
    const watchdog = new AutonomicWatchdog({
      heartbeatIntervalMs: 100,
    });

    watchdog.registerSubagent({
      agentId: "agent-temp",
      role: "implementer",
    });

    let called = false;
    watchdog.on("tick", () => {
      called = true;
    });

    watchdog.start();
    expect(watchdog.isRunning()).toBe(true);

    watchdog.dispose();
    expect(watchdog.isRunning()).toBe(false);

    // After dispose, no listeners fire
    void watchdog.tick();
    expect(called).toBe(false);
  });
});

describe("REMED-008: Invariants & Cleanliness Audit", () => {
  it("enforces zero TypeScript any and zero suppression directives across all watchdog files", () => {
    const watchdogDir = join(__dirname, "../../../orchestrating-long-tasks/scripts/src/watchdog");
    const sourceFiles = [
      join(watchdogDir, "constants.ts"),
      join(watchdogDir, "types.ts"),
      join(watchdogDir, "boot-gate-enforcer.ts"),
      join(watchdogDir, "autonomic-watchdog.ts"),
      join(watchdogDir, "index.ts"),
      __filename,
    ];

    const anyAnnotation = new RegExp(":\\s*any\\b");
    const anyCast = new RegExp("as\\s+any\\b");
    const anyGeneric = new RegExp("<\\s*any\\s*>");
    const tsIgnore = "@" + "ts-ignore";
    const tsExpectError = "@" + "ts-expect-error";
    const tsNoCheck = "@" + "ts-nocheck";
    const suppressionDirectiveA = "eslint" + "-disable";
    const suppressionDirectiveB = "oxlint" + "-disable";

    for (const filePath of sourceFiles) {
      const content = readFileSync(filePath, "utf8");

      expect(content).not.toMatch(anyAnnotation);
      expect(content).not.toMatch(anyCast);
      expect(content).not.toMatch(anyGeneric);
      expect(content.includes(tsIgnore)).toBe(false);
      expect(content.includes(tsExpectError)).toBe(false);
      expect(content.includes(tsNoCheck)).toBe(false);
      expect(content.includes(suppressionDirectiveA)).toBe(false);
      expect(content.includes(suppressionDirectiveB)).toBe(false);
    }
  });
});
