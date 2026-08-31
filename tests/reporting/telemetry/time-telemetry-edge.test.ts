import { describe, expect, it } from "bun:test";
import { getDualTime } from "../../../olt/scripts/src/core/dual-time/index.ts";
import {
  computeLatencyPercentiles,
  validateTimeTelemetryHealth,
  type HarnessActionTimeRecord,
} from "../../../olt/scripts/src/reporting/time-telemetry/index.ts";

describe("reporting/time-telemetry edge cases suite", () => {
  it("computes percentiles for empty and single-element arrays", () => {
    const emptyP = computeLatencyPercentiles([]);
    expect(emptyP.count).toBe(0);
    expect(emptyP.meanMs).toBe(0);

    const singleP = computeLatencyPercentiles([42]);
    expect(singleP.count).toBe(1);
    expect(singleP.minMs).toBe(42);
    expect(singleP.maxMs).toBe(42);
    expect(singleP.p50Ms).toBe(42);
    expect(singleP.p90Ms).toBe(42);
  });

  it("detects critical and high severity temporal anomalies", () => {
    const records: HarnessActionTimeRecord[] = [
      {
        actionId: "act-1",
        actionName: "broken:time",
        category: "task",
        actor: "impl_13",
        tier: 3,
        status: "failure",
        startedAt: getDualTime(),
        durationMs: -50,
      },
      {
        actionId: "act-2",
        actionName: "watchdog:drift",
        category: "watchdog",
        actor: "watchdog_01",
        tier: 1,
        status: "success",
        startedAt: getDualTime(),
        driftMs: 25000,
      },
    ];

    const health = validateTimeTelemetryHealth(records);
    expect(health.healthy).toBe(false);
    expect(health.anomalyCount).toBe(2);
    expect(health.anomalies.some((a) => a.type === "negative_duration")).toBe(true);
    expect(health.anomalies.some((a) => a.type === "clock_drift")).toBe(true);
  });
});
