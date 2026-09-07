import { describe, expect, it, spyOn, afterEach } from "bun:test";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import type {
  HarnessEvent,
  JsonObject,
  RunState,
} from "../../../../olt/scripts/src/core/contracts/index.ts";
import { reclaimDeadPulse } from "../../../../olt/scripts/src/mind/lifecycle/pulse/pulse-reclaim.ts";
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

describe("Mind Lifecycle Pulse Reclaim Execution", () => {
  const spies: Array<{ mockRestore: () => void }> = [];

  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
    spies.length = 0;
  });

  describe("reclaim execution and escalation", () => {
    it("reclaims expired pulse with observed activity as completed without halting", () => {
      const deadline = new Date(1_000_000).toISOString();
      const state = {
        pulse: {
          open: {
            pulse_id: "p-act",
            deadline_at: deadline,
            actor: "agent-a",
            opened_at: "2026-09-01T00:00:00.000Z",
          },
        },
      };
      const events = [
        makeEvent("mind-pulse-opened", 1, { pulse_id: "p-act" }),
        makeEvent("step-executed", 2, { pulse_id: "p-act" }),
      ];
      spies.push(
        spyOn(storeModule, "loadRun").mockReturnValue({
          state: state as unknown as RunState,
          events,
        }),
      );

      let transactEvent = "";
      let transactActor = "";
      const workingState: Record<string, unknown> = {
        pulse: {
          open: { pulse_id: "p-act" },
          last: { armed_interval_ms: 500_000, zero_value_streak: 2 },
        },
      };
      spies.push(
        spyOn(storeModule, "transact").mockImplementation(
          (_root, actor, evt, _payload, mutator) => {
            transactActor = actor;
            transactEvent = evt;
            mutator(workingState as unknown as JsonObject);
          },
        ),
      );
      let writtenRecord: unknown = null;
      spies.push(
        spyOn(lastPulseModule, "writeLastPulse").mockImplementation((_root, rec) => {
          writtenRecord = rec;
        }),
      );

      const res = reclaimDeadPulse("/run", {
        now: 2_000_000,
        clock: { now: () => new Date(2_000_000) },
      });
      expect(res.reclaimed).toBe(true);
      expect(res.outcome).toBe("completed");
      expect(res.consecutiveCrashes).toBe(0);
      expect(res.halted).toBe(false);
      expect(res.evidence).toContain("classified completed");
      expect(transactActor).toBe("agent-a");
      expect(transactEvent).toBe("mind-pulse-reclaimed");

      const workingPulse = workingState.pulse as Record<string, unknown>;
      expect(workingPulse.open).toBeNull();
      const last = workingPulse.last as Record<string, unknown>;
      expect(last.outcome).toBe("completed");
      expect(last.consecutive_crashes).toBe(0);
      expect(last.zero_value_streak).toBe(0);
      expect(last.arm_mechanism).toBe("activity-recovery");
      expect(last.armed_interval_ms).toBe(500_000);
      expect(writtenRecord).toEqual({
        at: new Date(2_000_000).toISOString(),
        pulse_id: "p-act",
        outcome: "completed",
        next_wake_at: null,
      });
    });

    it("reclaims crashed pulse incrementing crash count below threshold", () => {
      const deadline = new Date(1_000_000).toISOString();
      const state = {
        pulse: {
          open: { pulse_id: "p-crash-1", deadline_at: deadline },
          last: { outcome: "crashed", consecutive_crashes: 1, zero_value_streak: 1 },
        },
      };
      spies.push(
        spyOn(storeModule, "loadRun").mockReturnValue({
          state: state as unknown as RunState,
          events: [],
        }),
      );

      const workingState: Record<string, unknown> = {
        pulse: { open: { pulse_id: "p-crash-1" }, last: { zero_value_streak: 1 } },
      };
      spies.push(
        spyOn(storeModule, "transact").mockImplementation((_r, _a, _e, _p, mutator) => {
          mutator(workingState as unknown as JsonObject);
        }),
      );
      spies.push(spyOn(lastPulseModule, "writeLastPulse").mockImplementation(() => {}));

      const res = reclaimDeadPulse("/run", { now: 1_500_000, actor: "reclaimer" });
      expect(res.reclaimed).toBe(true);
      expect(res.outcome).toBe("crashed");
      expect(res.consecutiveCrashes).toBe(2);
      expect(res.halted).toBe(false);

      const workingPulse = workingState.pulse as Record<string, unknown>;
      const last = workingPulse.last as Record<string, unknown>;
      expect(last.consecutive_crashes).toBe(2);
      expect(last.zero_value_streak).toBe(2);
      expect(last.armed_interval_ms).toBe(900_000);
      expect(last.arm_mechanism).toBe("crash-recovery");
    });

    it("reclaims crashed pulse and escalates to HALT when threshold is reached", () => {
      const deadline = new Date(1_000_000).toISOString();
      const state = {
        pulse: {
          open: { pulse_id: "p-crash-3", deadline_at: deadline },
          last: { outcome: "crashed", consecutive_crashes: 2 },
        },
      };
      spies.push(
        spyOn(storeModule, "loadRun").mockReturnValue({
          state: state as unknown as RunState,
          events: [],
        }),
      );

      const workingState: Record<string, unknown> = {
        pulse: { open: { pulse_id: "p-crash-3" } },
      };
      spies.push(
        spyOn(storeModule, "transact").mockImplementation((_r, _a, _e, _p, mutator) => {
          mutator(workingState as unknown as JsonObject);
        }),
      );
      spies.push(spyOn(lastPulseModule, "writeLastPulse").mockImplementation(() => {}));

      const res = reclaimDeadPulse("/run", { now: 2_000_000, deterministicCrashThreshold: 3 });
      expect(res.reclaimed).toBe(true);
      expect(res.outcome).toBe("crashed");
      expect(res.consecutiveCrashes).toBe(3);
      expect(res.halted).toBe(true);
      expect(res.haltReason).toContain("consecutive pulse crashes threshold exceeded");

      const workingPulse = workingState.pulse as Record<string, unknown>;
      const workingMind = workingState.mind as Record<string, unknown>;
      const escalations = workingState.escalations as Array<Record<string, unknown>>;
      expect(workingMind.halted).toBe(true);
      expect(workingMind.halt_reason).toContain("threshold exceeded");
      expect(escalations).toHaveLength(1);
      expect(escalations[0]?.reason).toBe("consecutive_pulse_crashes");

      const last = workingPulse.last as Record<string, unknown>;
      expect(last.armed_interval_ms).toBeNull();
      expect(last.armed_at).toBeNull();
      expect(last.terminal_reason).toContain("threshold exceeded");
    });

    it("throws HarnessError if pulse changes concurrently during transaction mutator", () => {
      const deadline = new Date(1_000_000).toISOString();
      const state = { pulse: { open: { pulse_id: "p1", deadline_at: deadline } } };
      spies.push(
        spyOn(storeModule, "loadRun").mockReturnValue({
          state: state as unknown as RunState,
          events: [],
        }),
      );

      spies.push(
        spyOn(storeModule, "transact").mockImplementation((_r, _a, _e, _p, mutator) => {
          const working = { pulse: { open: { pulse_id: "p-changed" } } };
          mutator(working as unknown as JsonObject);
        }),
      );

      expect(() => reclaimDeadPulse("/run", { now: 2_000_000 })).toThrow(HarnessError);
    });
  });
});
