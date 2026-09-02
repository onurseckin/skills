import { describe, expect, it } from "bun:test";
import { MindCadenceEngine } from "../../../../../olt/scripts/src/mind/lifecycle/cadence/rollover.ts";
import {
  CLOSING_FORBIDDEN_FOR_MIND,
  DEFAULT_CADENCE_BASE_INTERVAL_MS,
  createCadenceTrigger,
} from "../../../../../olt/scripts/src/mind/lifecycle/cadence/types.ts";
import type { CadenceEvent } from "../../../../../olt/scripts/src/mind/lifecycle/cadence/types.ts";

describe("MindCadenceEngine Unit Coverage Suite", () => {
  it("initializes with default options and exposes initial state and telemetry", () => {
    const engine = new MindCadenceEngine();
    const state = engine.getState();
    expect(state.status).toBe("RUNNING");
    expect(state.currentPhase).toBe("IDLE");
    expect(state.currentIntervalMs).toBe(DEFAULT_CADENCE_BASE_INTERVAL_MS);
    expect(state.infiniteCadenceEnforced).toBe(true);
    expect(state.closing_permitted).toBe(false);
    expect(state.invariant).toBe(CLOSING_FORBIDDEN_FOR_MIND);

    const telem = engine.getTelemetry();
    expect(telem.totalPulses).toBe(0);
    expect(telem.totalRollovers).toBe(0);
    expect(telem.totalImmediateRollovers).toBe(0);
    expect(telem.immediateRolloverRatio).toBe(1.0);
    expect(telem.averagePulseDurationMs).toBe(0);
    expect(telem.totalZeroSleepTransitions).toBe(0);
    expect(telem.quiescenceStreak).toBe(0);
    expect(telem.lastTriggerType).toBeNull();
    expect(telem.isAntiIdleActive).toBe(true);
  });

  it("initializes with custom options and generation", () => {
    const customRandom = () => 0.42;
    const engine = new MindCadenceEngine({
      baseIntervalMs: 5000,
      maxIntervalMs: 20000,
      maxPauseIntervalMs: 30000,
      applyJitter: false,
      random: customRandom,
      generation: 3,
    });
    const state = engine.getState();
    expect(state.generation).toBe(3);
    expect(state.currentIntervalMs).toBe(5000);
  });

  it("subscribes and unsubscribes listeners via on()", async () => {
    const engine = new MindCadenceEngine({ baseIntervalMs: 1000 });
    const events: CadenceEvent[] = [];
    const unsubscribe = engine.on((event) => {
      events.push(event);
    });

    await engine.step({ pendingTasks: 1 });
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe("ROLLOVER_EXECUTED");

    unsubscribe();
    await engine.step({ pendingTasks: 1 });
    expect(events.length).toBe(1);
  });

  it("evaluates rollover decisions with default and custom options", () => {
    const engine = new MindCadenceEngine({ baseIntervalMs: 1000, applyJitter: false });
    const defaultDecision = engine.evaluateRollover();
    expect(defaultDecision.shouldRolloverImmediately).toBe(false);
    expect(defaultDecision.targetDelayMs).toBeGreaterThan(0);

    const activeDecision = engine.evaluateRollover(createCadenceTrigger("WORK_DETECTED"), 3, 1, {
      activeRunnableTasks: 2,
      inFlightTasks: 1,
      blockedTasks: 0,
    });
    expect(activeDecision.shouldRolloverImmediately).toBe(true);
    expect(activeDecision.targetDelayMs).toBe(0);
  });

  it("executes immediate rollover step when work is pending", async () => {
    const engine = new MindCadenceEngine({ baseIntervalMs: 2000 });
    const fixedNow = "2026-09-01T12:00:00.000Z";

    const result = await engine.step({
      now: fixedNow,
      trigger: createCadenceTrigger("WORK_DETECTED"),
      pendingTasks: 2,
      activeRunnableTasks: 2,
      pulseOutcome: "advance_dispatched",
      pulseDurationMs: 150,
    });

    expect(result.executedImmediately).toBe(true);
    expect(result.delayMs).toBe(0);
    expect(result.newState.currentIntervalMs).toBe(0);
    expect(result.newState.pulseCounter).toBe(1);
    expect(result.newState.rolloverCounter).toBe(1);
    expect(result.newState.immediateRolloverCounter).toBe(1);
    expect(result.newState.lastPulseAt).toBe(fixedNow);
    expect(result.newState.lastRolloverAt).toBe(fixedNow);

    const telem = engine.getTelemetry();
    expect(telem.totalPulses).toBe(1);
    expect(telem.totalRollovers).toBe(1);
    expect(telem.totalImmediateRollovers).toBe(1);
    expect(telem.immediateRolloverRatio).toBe(1);
    expect(telem.totalZeroSleepTransitions).toBe(1);
    expect(telem.averagePulseDurationMs).toBe(150);
    expect(telem.lastTriggerType).toBe("WORK_DETECTED");
  });

  it("executes delayed step with default inputs and quiescence backoff", async () => {
    const engine = new MindCadenceEngine({ baseIntervalMs: 2000, applyJitter: false });
    const result = await engine.step();

    expect(result.executedImmediately).toBe(false);
    expect(result.delayMs).toBeGreaterThan(0);
    expect(result.newState.pulseCounter).toBe(0);
    expect(result.newState.rolloverCounter).toBe(1);
    expect(result.newState.immediateRolloverCounter).toBe(0);
    expect(result.newState.lastPulseAt).toBeNull();

    const telem = engine.getTelemetry();
    expect(telem.immediateRolloverRatio).toBe(0);
    expect(telem.lastTriggerType).toBe("MANUAL_DISPATCH");
  });

  it("handles halt and resume transitions and maintains safety invariants", async () => {
    const engine = new MindCadenceEngine({ baseIntervalMs: 3000 });
    const events: CadenceEvent[] = [];
    engine.on((e) => events.push(e));

    engine.halt("Overheat safety triggered");
    let state = engine.getState();
    expect(state.status).toBe("HALTED");
    expect(state.currentPhase).toBe("HALTED");
    expect(state.currentIntervalMs).toBe(0);
    expect(events.length).toBe(1);
    expect(events[0]?.trigger.type).toBe("SAFETY_HALT");

    const telemHalted = engine.getTelemetry();
    expect(telemHalted.isAntiIdleActive).toBe(false);

    const stepResult = await engine.step({ pendingTasks: 0 });
    expect(stepResult.newState.status).toBe("HALTED");

    engine.resume();
    state = engine.getState();
    expect(state.status).toBe("RUNNING");
    expect(state.currentPhase).toBe("ACTIVE");
    expect(state.currentIntervalMs).toBe(3000);

    engine.halt();
    expect(engine.getState().status).toBe("HALTED");
  });
});
