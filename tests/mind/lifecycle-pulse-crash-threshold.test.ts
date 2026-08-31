import { describe, expect, test } from "bun:test";
import { DEFAULT_CONSECUTIVE_CRASH_THRESHOLD as THRESHOLD_FROM_TYPES } from "../../olt/scripts/src/mind/lifecycle/pulse/types.ts";
import {
  DEFAULT_CONSECUTIVE_CRASH_THRESHOLD as THRESHOLD_FROM_PULSE_INDEX,
  type LastPulseRecord,
  type LastPulsePayload,
  type PulseReclaimOptions,
  type PulseReclaimResult,
  type PulseReclaimResult as ReclaimDeadPulseResult,
  writeLastPulse,
  readLastPulse,
  reconcileLastPulse,
  resolveLastPulsePath,
  pulseProducedActivity,
  parseNowMs,
  reclaimDeadPulse,
} from "../../olt/scripts/src/mind/lifecycle/pulse/index.ts";
import { DEFAULT_CONSECUTIVE_CRASH_THRESHOLD as THRESHOLD_FROM_LIFECYCLE_INDEX } from "../../olt/scripts/src/mind/lifecycle/index.ts";
import { DEFAULT_CONSECUTIVE_CRASH_THRESHOLD as THRESHOLD_FROM_LIVENESS_INDEX } from "../../olt/scripts/src/mind/lifecycle/liveness/index.ts";

describe("DEFAULT_CONSECUTIVE_CRASH_THRESHOLD and pulse exports", () => {
  test("DEFAULT_CONSECUTIVE_CRASH_THRESHOLD is exported from types.ts with canonical value 3", () => {
    expect(THRESHOLD_FROM_TYPES).toBe(3);
    expect(typeof THRESHOLD_FROM_TYPES).toBe("number");
  });

  test("DEFAULT_CONSECUTIVE_CRASH_THRESHOLD is re-exported from lifecycle/pulse/index.ts", () => {
    expect(THRESHOLD_FROM_PULSE_INDEX).toBe(3);
    expect(THRESHOLD_FROM_PULSE_INDEX).toBe(THRESHOLD_FROM_TYPES);
  });

  test("DEFAULT_CONSECUTIVE_CRASH_THRESHOLD is consistent across lifecycle and liveness index exports", () => {
    expect(THRESHOLD_FROM_LIFECYCLE_INDEX).toBe(3);
    expect(THRESHOLD_FROM_LIVENESS_INDEX).toBe(3);
    expect(THRESHOLD_FROM_LIFECYCLE_INDEX).toBe(THRESHOLD_FROM_PULSE_INDEX);
    expect(THRESHOLD_FROM_LIVENESS_INDEX).toBe(THRESHOLD_FROM_PULSE_INDEX);
  });

  test("lifecycle/pulse/index.ts exports all canonical pulse lifecycle functions", () => {
    expect(typeof writeLastPulse).toBe("function");
    expect(typeof readLastPulse).toBe("function");
    expect(typeof reconcileLastPulse).toBe("function");
    expect(typeof resolveLastPulsePath).toBe("function");
    expect(typeof pulseProducedActivity).toBe("function");
    expect(typeof parseNowMs).toBe("function");
    expect(typeof reclaimDeadPulse).toBe("function");
  });

  test("pulseProducedActivity correctly distinguishes quiescent and active pulse records", () => {
    const activeRecord: LastPulseRecord = {
      at: "2026-08-29T10:00:00.000Z",
      pulse_id: "pulse-123",
      outcome: "completed",
      next_wake_at: "2026-08-29T10:15:00.000Z",
    };
    const quiescentRecord: LastPulseRecord = {
      at: "2026-08-29T10:00:00.000Z",
      pulse_id: "pulse-124",
      outcome: "idle_quiescent",
      next_wake_at: "2026-08-29T10:15:00.000Z",
    };
    const nullRecord: LastPulseRecord | null = null;

    expect(pulseProducedActivity(activeRecord)).toBe(true);
    expect(pulseProducedActivity(quiescentRecord)).toBe(false);
    expect(pulseProducedActivity(nullRecord)).toBe(false);
  });

  test("parseNowMs parses dates, numbers, and strings deterministically", () => {
    const timestamp = 1756461600000;
    const isoString = new Date(timestamp).toISOString();
    const dateObj = new Date(timestamp);

    expect(parseNowMs(timestamp)).toBe(timestamp);
    expect(parseNowMs(dateObj)).toBe(timestamp);
    expect(parseNowMs(isoString)).toBe(timestamp);
  });

  test("type contracts compile cleanly and satisfy interface structures", () => {
    const payload: LastPulsePayload = {
      at: "2026-08-29T10:00:00.000Z",
      pulse_id: "p-1",
      outcome: "crashed",
      next_wake_at: null,
    };
    const options: PulseReclaimOptions = {
      pulseId: "p-1",
      deterministicCrashThreshold: THRESHOLD_FROM_PULSE_INDEX,
    };
    const result: PulseReclaimResult = {
      reclaimed: true,
      pulseId: "p-1",
      consecutiveCrashes: THRESHOLD_FROM_PULSE_INDEX,
      halted: true,
      haltReason: "Crash threshold exceeded",
    };
    const aliasResult: ReclaimDeadPulseResult = result;

    expect(payload.pulse_id).toBe("p-1");
    expect(options.deterministicCrashThreshold).toBe(3);
    expect(result.consecutiveCrashes).toBe(3);
    expect(aliasResult.halted).toBe(true);
  });
});
