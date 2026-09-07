import { describe, expect, it, spyOn, afterEach } from "bun:test";
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
    run_id: "run-pulse-1",
    actor: "mind",
    digest: "d-test",
    prev_digest: "p-test",
    payload: payload as unknown as HarnessEvent["payload"],
  };
}

describe("Mind Lifecycle Pulse Reclaim Suite", () => {
  const spies: Array<{ mockRestore: () => void }> = [];

  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
    spies.length = 0;
  });

  describe("Constants and parseNowMs", () => {
    it("exports default crash threshold of 3", () => {
      expect(DEFAULT_CONSECUTIVE_CRASH_THRESHOLD).toBe(3);
    });

    it("parses now input from number, Date instance, ISO string, or falls back to Date.now()", () => {
      const fixed = 1_700_000_000_000;
      expect(parseNowMs(fixed)).toBe(fixed);
      expect(parseNowMs(new Date(fixed))).toBe(fixed);
      expect(parseNowMs("2026-09-01T12:00:00.000Z")).toBe(Date.parse("2026-09-01T12:00:00.000Z"));
      expect(parseNowMs("invalid-timestamp-string")).toBeGreaterThan(0);
      expect(parseNowMs(undefined)).toBeGreaterThan(0);
    });
  });

  describe("pulseProducedActivity", () => {
    it("returns false when events array is empty or anchor not found", () => {
      expect(pulseProducedActivity([], "p1")).toBe(false);
      expect(pulseProducedActivity([makeEvent("custom-event", 1)], "p1")).toBe(false);
    });

    it("identifies activity when events occur after mind-pulse-opened with matching pulseId", () => {
      const events = [
        makeEvent("mind-pulse-opened", 1, { pulse_id: "p1" }),
        makeEvent("step-executed", 2, { pulse_id: "p1" }),
      ];
      expect(pulseProducedActivity(events, "p1")).toBe(true);
      expect(
        pulseProducedActivity([makeEvent("mind-pulse-opened", 1, { pulse_id: "p1" })], "p1"),
      ).toBe(false);
    });

    it("identifies activity after mind-initialized event", () => {
      const events = [makeEvent("mind-initialized", 1), makeEvent("governance-pinned", 2)];
      expect(pulseProducedActivity(events, "p-any")).toBe(true);
    });

    it("ignores mind-pulse-opened with non-matching or non-string pulse_id", () => {
      const events = [
        makeEvent("mind-pulse-opened", 1, { pulse_id: 12345 }),
        makeEvent("mind-pulse-opened", 2, { pulse_id: "p-other" }),
        makeEvent("step-executed", 3),
      ];
      expect(pulseProducedActivity(events, "p1")).toBe(false);
    });
  });

  describe("reclaimDeadPulse validation and error guards", () => {
    it("validates graceSeconds bounds and integer constraints", () => {
      expect(() => reclaimDeadPulse("/run", { graceSeconds: -1 })).toThrow(TypeError);
      expect(() => reclaimDeadPulse("/run", { graceSeconds: 86401 })).toThrow(TypeError);
      expect(() => reclaimDeadPulse("/run", { graceSeconds: 5.5 })).toThrow(TypeError);
      expect(() => reclaimDeadPulse("/run", { graceSeconds: Number.NaN })).toThrow(TypeError);
    });

    it("handles missing open pulse when target ID is specified or omitted", () => {
      const stateNoOpen = {
        pulse: { open: null, last: { outcome: "crashed", consecutive_crashes: 2 } },
        mind: { halted: true, halt_reason: "prior halt" },
      };
      spies.push(
        spyOn(storeModule, "loadRun").mockReturnValue({
          state: stateNoOpen as unknown as RunState,
          events: [],
        }),
      );

      expect(() => reclaimDeadPulse("/run", { pulseId: "p-expected" })).toThrow(HarnessError);
      expect(() => reclaimDeadPulse("/run", { expectedPulseId: "p-expected" })).toThrow(
        HarnessError,
      );

      const res = reclaimDeadPulse("/run");
      expect(res.reclaimed).toBe(false);
      expect(res.consecutiveCrashes).toBe(2);
      expect(res.halted).toBe(true);
      expect(res.haltReason).toBe("prior halt");
      expect(res.reason).toBe("no open pulse");
    });

    it("throws HarnessError when targetPulseId does not match open pulse_id", () => {
      const state = {
        pulse: { open: { pulse_id: "p-actual", deadline_at: "2026-09-01T12:00:00.000Z" } },
      };
      spies.push(
        spyOn(storeModule, "loadRun").mockReturnValue({
          state: state as unknown as RunState,
          events: [],
        }),
      );

      expect(() => reclaimDeadPulse("/run", { pulseId: "p-mismatch" })).toThrow(HarnessError);
    });

    it("throws HarnessError on missing or invalid deadline_at timestamp in open pulse", () => {
      const stateInvalid = { pulse: { open: { pulse_id: "p1", deadline_at: "invalid-date" } } };
      spies.push(
        spyOn(storeModule, "loadRun").mockReturnValue({
          state: stateInvalid as unknown as RunState,
          events: [],
        }),
      );
      expect(() => reclaimDeadPulse("/run")).toThrow(HarnessError);

      const stateMissing = { pulse: { open: { pulse_id: "p1" } } };
      spies.push(
        spyOn(storeModule, "loadRun").mockReturnValue({
          state: stateMissing as unknown as RunState,
          events: [],
        }),
      );
      expect(() => reclaimDeadPulse("/run")).toThrow(HarnessError);
    });

    it("returns early when pulse is still within deadline and grace period", () => {
      const deadline = new Date(1_000_000).toISOString();
      const state = { pulse: { open: { pulse_id: "p1", deadline_at: deadline } } };
      spies.push(
        spyOn(storeModule, "loadRun").mockReturnValue({
          state: state as unknown as RunState,
          events: [],
        }),
      );

      const res = reclaimDeadPulse("/run", { now: 1_020_000, graceSeconds: 30 });
      expect(res.reclaimed).toBe(false);
      expect(res.pulseId).toBe("p1");
      expect(res.reason).toContain("still within deadline");
    });

    it("handles TOCTOU concurrent pulse close or reclaim during fresh loadRun", () => {
      const deadline = new Date(1_000_000).toISOString();
      const state1 = { pulse: { open: { pulse_id: "p1", deadline_at: deadline } } };
      const state2 = { pulse: { open: null } };
      let loadCount = 0;
      spies.push(
        spyOn(storeModule, "loadRun").mockImplementation(() => {
          loadCount++;
          return { state: (loadCount === 1 ? state1 : state2) as unknown as RunState, events: [] };
        }),
      );

      const res = reclaimDeadPulse("/run", { now: 2_000_000 });
      expect(res.reclaimed).toBe(false);
      expect(res.reason).toContain("closed or reclaimed concurrently");
    });
  });
});
