import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import type {
  HarnessEvent,
  JsonObject,
  RunState,
} from "../../../../olt/scripts/src/core/contracts/index.ts";
import {
  DEFAULT_CONSECUTIVE_CRASH_THRESHOLD,
  parseNowMs,
  pulseProducedActivity,
  reclaimDeadPulse,
} from "../../../../olt/scripts/src/mind/lifecycle/pulse/pulse-reclaim.ts";
import * as storeModule from "../../../../olt/scripts/src/engine/store/index.ts";
import * as lastPulseModule from "../../../../olt/scripts/src/mind/lifecycle/pulse/last-pulse.ts";

function makeEvent(
  kind: string,
  sequence: number,
  payload: Record<string, unknown> = {},
): HarnessEvent {
  return {
    sequence,
    timestamp: "2026-09-01T12:00:00.000Z",
    kind: kind as HarnessEvent["kind"],
    run_id: "run-crash-test",
    actor: "mind",
    digest: "d-test",
    prev_digest: "p-test",
    payload: payload as unknown as HarnessEvent["payload"],
  };
}

describe("Mind Assembly Lifecycle Crash Threshold Suite", () => {
  const spies: Array<{ mockRestore: () => void }> = [];

  beforeEach(() => {
    spies.push(spyOn(lastPulseModule, "writeLastPulse").mockImplementation(() => {}));
  });

  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
    spies.length = 0;
  });

  describe("Constants, Parsing & Activity Heuristics", () => {
    it("exports default consecutive crash threshold of 3", () => {
      expect(DEFAULT_CONSECUTIVE_CRASH_THRESHOLD).toBe(3);
    });

    it("parses now input from number, Date instance, ISO string, and fallback", () => {
      const fixedMs = 1_700_000_000_000;
      expect(parseNowMs(fixedMs)).toBe(fixedMs);
      expect(parseNowMs(new Date(fixedMs))).toBe(fixedMs);
      expect(parseNowMs("2026-09-01T12:00:00.000Z")).toBe(Date.parse("2026-09-01T12:00:00.000Z"));
      expect(parseNowMs("invalid-timestamp")).toBeGreaterThan(0);
      expect(parseNowMs(undefined)).toBeGreaterThan(0);
    });

    it("evaluates pulseProducedActivity correctly for empty, matching, and quiescent events", () => {
      expect(pulseProducedActivity([], "p1")).toBe(false);

      const unanchored = [makeEvent("custom-action", 1)];
      expect(pulseProducedActivity(unanchored, "p1")).toBe(false);

      const matching = [
        makeEvent("mind-pulse-opened", 1, { pulse_id: "p1" }),
        makeEvent("step-executed", 2),
      ];
      expect(pulseProducedActivity(matching, "p1")).toBe(true);

      const initializedAnchor = [makeEvent("mind-initialized", 1), makeEvent("step-executed", 2)];
      expect(pulseProducedActivity(initializedAnchor, "p1")).toBe(true);

      const mismatched = [
        makeEvent("mind-pulse-opened", 1, { pulse_id: "other" }),
        makeEvent("step-executed", 2),
      ];
      expect(pulseProducedActivity(mismatched, "p1")).toBe(false);

      const quiescent = [makeEvent("mind-pulse-opened", 1, { pulse_id: "p1" })];
      expect(pulseProducedActivity(quiescent, "p1")).toBe(false);
    });
  });

  describe("reclaimDeadPulse Error Guards & Grace Bounds", () => {
    it("validates graceSeconds bounds and constraints", () => {
      expect(() => reclaimDeadPulse("/run", { graceSeconds: -1 })).toThrow(TypeError);
      expect(() => reclaimDeadPulse("/run", { graceSeconds: 86401 })).toThrow(TypeError);
      expect(() => reclaimDeadPulse("/run", { graceSeconds: 2.5 })).toThrow(TypeError);
    });

    it("returns early when pulse is still within deadline and grace period", () => {
      const state = {
        pulse: { open: { pulse_id: "p-alive", deadline_at: new Date(1_000_000).toISOString() } },
      };
      spies.push(
        spyOn(storeModule, "loadRun").mockReturnValue({
          state: state as unknown as RunState,
          events: [],
        }),
      );

      const res = reclaimDeadPulse("/run", { now: 1_000_000, graceSeconds: 10 });
      expect(res.reclaimed).toBe(false);
      expect(res.pulseId).toBe("p-alive");
      expect(res.reason).toContain("still within deadline");
    });

    it("handles missing open pulse gracefully when pulseId is omitted without throwing", () => {
      const state = {
        pulse: { open: null, last: { outcome: "completed", consecutive_crashes: 0 } },
        mind: { halted: false },
      };
      spies.push(
        spyOn(storeModule, "loadRun").mockReturnValue({
          state: state as unknown as RunState,
          events: [],
        }),
      );

      const res = reclaimDeadPulse("/run", { now: 2_000_000 });
      expect(res.reclaimed).toBe(false);
      expect(res.reason).toBe("no open pulse");
    });

    it("throws HarnessError on missing or invalid deadline_at timestamp in open pulse", () => {
      const state = { pulse: { open: { pulse_id: "p-bad-deadline", deadline_at: "not-a-date" } } };
      spies.push(
        spyOn(storeModule, "loadRun").mockReturnValue({
          state: state as unknown as RunState,
          events: [],
        }),
      );

      expect(() => reclaimDeadPulse("/run", { now: 2_000_000 })).toThrow(HarnessError);
    });

    it("throws on targetPulseId mismatch when expectedPulseId does not match open pulse", () => {
      const state = {
        pulse: {
          open: {
            pulse_id: "p-real",
            deadline_at: new Date(1_000_000).toISOString(),
          },
        },
      };
      spies.push(
        spyOn(storeModule, "loadRun").mockReturnValue({
          state: state as unknown as RunState,
          events: [],
        }),
      );

      expect(() => reclaimDeadPulse("/run", { pulseId: "p-wrong", now: 2_000_000 })).toThrow(
        HarnessError,
      );
    });
  });

  describe("Crash Escalation Ladder & HALT Threshold Progression", () => {
    const setupReclaimState = (priorCrashes: number, events: HarnessEvent[] = []) => {
      const deadline = new Date(1_000_000).toISOString();
      const state = {
        pulse: {
          open: { pulse_id: "p-reclaim", deadline_at: deadline, actor: "mind" },
          last: { outcome: "crashed", consecutive_crashes: priorCrashes },
        },
        mind: { halted: false },
      };

      spies.push(
        spyOn(storeModule, "loadRun").mockReturnValue({
          state: state as unknown as RunState,
          events,
        }),
      );

      const workingState: Record<string, unknown> = {
        pulse: {
          open: { pulse_id: "p-reclaim" },
          last: { outcome: "crashed", consecutive_crashes: priorCrashes },
        },
        mind: { halted: false },
      };

      spies.push(
        spyOn(storeModule, "transact").mockImplementation(
          (_root, _actor, _evt, _payload, mutator) => {
            mutator(workingState as unknown as JsonObject);
          },
        ),
      );

      return workingState;
    };

    it("reclaims first crash (0 -> 1): stays below threshold and does not halt", () => {
      const working = setupReclaimState(0);
      const res = reclaimDeadPulse("/run", { now: 2_000_000 });

      expect(res.reclaimed).toBe(true);
      expect(res.outcome).toBe("crashed");
      expect(res.consecutiveCrashes).toBe(1);
      expect(res.halted).toBe(false);

      const pulse = working.pulse as Record<string, unknown>;
      const last = pulse.last as Record<string, unknown>;
      expect(last.consecutive_crashes).toBe(1);
      const mind = working.mind as Record<string, unknown>;
      expect(mind.halted).toBe(false);
    });

    it("reclaims second crash (1 -> 2): increments count and stays below threshold", () => {
      const working = setupReclaimState(1);
      const res = reclaimDeadPulse("/run", { now: 2_000_000 });

      expect(res.reclaimed).toBe(true);
      expect(res.outcome).toBe("crashed");
      expect(res.consecutiveCrashes).toBe(2);
      expect(res.halted).toBe(false);

      const pulse = working.pulse as Record<string, unknown>;
      const last = pulse.last as Record<string, unknown>;
      expect(last.consecutive_crashes).toBe(2);
      const mind = working.mind as Record<string, unknown>;
      expect(mind.halted).toBe(false);
    });

    it("reclaims third crash (2 -> 3): reaches threshold and escalates to HALT", () => {
      const working = setupReclaimState(2);
      const res = reclaimDeadPulse("/run", { now: 2_000_000 });

      expect(res.reclaimed).toBe(true);
      expect(res.outcome).toBe("crashed");
      expect(res.consecutiveCrashes).toBe(3);
      expect(res.halted).toBe(true);
      expect(res.haltReason).toContain("consecutive pulse crashes threshold exceeded");

      const pulse = working.pulse as Record<string, unknown>;
      const last = pulse.last as Record<string, unknown>;
      expect(last.consecutive_crashes).toBe(3);
      const mind = working.mind as Record<string, unknown>;
      expect(mind.halted).toBe(true);
      expect(mind.halt_reason).toContain("consecutive pulse crashes threshold exceeded");
    });

    it("reclaims expired pulse with observed activity as completed without halting or incrementing crash count", () => {
      const events = [
        makeEvent("mind-pulse-opened", 1, { pulse_id: "p-reclaim" }),
        makeEvent("step-executed", 2),
      ];
      const working = setupReclaimState(2, events);
      const res = reclaimDeadPulse("/run", { now: 2_000_000 });

      expect(res.reclaimed).toBe(true);
      expect(res.outcome).toBe("completed");
      expect(res.consecutiveCrashes).toBe(0);
      expect(res.halted).toBe(false);

      const pulse = working.pulse as Record<string, unknown>;
      const last = pulse.last as Record<string, unknown>;
      expect(last.outcome).toBe("completed");
      expect(last.consecutive_crashes).toBe(0);
      const mind = working.mind as Record<string, unknown>;
      expect(mind.halted).toBe(false);
    });

    it("immediately escalates to HALT on first crash when deterministicCrashThreshold is 1", () => {
      setupReclaimState(0);
      const res = reclaimDeadPulse("/run", { now: 2_000_000, deterministicCrashThreshold: 1 });

      expect(res.reclaimed).toBe(true);
      expect(res.outcome).toBe("crashed");
      expect(res.consecutiveCrashes).toBe(1);
      expect(res.halted).toBe(true);
      expect(res.haltReason).toContain("consecutive pulse crashes threshold exceeded");
    });

    it("propagates custom actor parameter through to transaction payload", () => {
      let passedActor = "";
      setupReclaimState(0);
      spies.push(
        spyOn(storeModule, "transact").mockImplementation(
          (_root, actor, _evt, _payload, mutator) => {
            passedActor = actor;
            mutator({
              pulse: { open: { pulse_id: "p-reclaim" } },
              mind: { halted: false },
            } as unknown as JsonObject);
          },
        ),
      );

      reclaimDeadPulse("/run", { now: 2_000_000, actor: "custom-watchdog" });
      expect(passedActor).toBe("custom-watchdog");
    });
  });
});
