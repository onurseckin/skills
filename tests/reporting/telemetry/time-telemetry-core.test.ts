import { describe, expect, it } from "bun:test";
import {
  buildTimeTelemetryReport,
  categorizeHarnessAction,
  computeLatencyPercentiles,
  OmnipresentTelemetryCollector,
  validateTimeTelemetryHealth,
} from "../../../../olt/scripts/src/reporting/time-telemetry/index.ts";

describe("reporting/time-telemetry core suite", () => {
  it("categorizes actions accurately", () => {
    const taskCat = categorizeHarnessAction("task:claim");
    expect(taskCat.category).toBe("task");
    expect(taskCat.defaultTier).toBe(3);

    const mindCat = categorizeHarnessAction("mind:pulse");
    expect(mindCat.category).toBe("mind");
    expect(mindCat.defaultTier).toBe(0);

    const docCat = categorizeHarnessAction("doctor");
    expect(docCat.category).toBe("doctor");
    expect(docCat.defaultTier).toBe(1);
  });

  it("computes latency percentiles correctly", () => {
    const latencies = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const p = computeLatencyPercentiles(latencies);
    expect(p.p50Ms).toBe(50);
    expect(p.p90Ms).toBe(90);
    expect(p.p99Ms).toBe(100);
    expect(p.minMs).toBe(10);
    expect(p.maxMs).toBe(100);
    expect(p.meanMs).toBe(55);
  });

  it("tracks action spans with OmnipresentTelemetryCollector", () => {
    const collector = new OmnipresentTelemetryCollector();
    const span = collector.startSpan("task:execute", "impl_13", { category: "task", tier: 3 });
    span.startSubStep("step1");
    span.finishSubStep("success");
    const record = collector.finishSpan(span.actionId, "success");

    expect(collector.getRecords().length).toBe(1);
    expect(record.status).toBe("success");

    const report = buildTimeTelemetryReport(collector.getRecords(), 0, { runId: "run-time-test" });
    expect(report.runId).toBe("run-time-test");
    expect(report.totalDurationMs).toBeGreaterThanOrEqual(0);

    const health = validateTimeTelemetryHealth(collector.getRecords());
    expect(health.healthy).toBe(true);
  });
});
