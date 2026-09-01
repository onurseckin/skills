import { describe, expect, it } from "bun:test";
import { getDualTime } from "../../../olt/scripts/src/core/dual-time/index.ts";
import {
  buildTimeTelemetryReport,
  categorizeHarnessAction,
  computeLatencyPercentiles,
  enrichHarnessEvent,
  enrichWithDualTime,
  extractDualTime,
  formatDualTimeTable,
  OmnipresentTelemetryCollector,
  renderDualTimeHeader,
  renderOmnipresentTelemetryMarkdown,
  validateTimeTelemetryHealth,
  type HarnessActionTimeRecord,
} from "../../../olt/scripts/src/reporting/time-telemetry/index.ts";

export const timeTelemetrySuiteName = "reporting/time-telemetry suite: setup, core, and edge cases";

describe(timeTelemetrySuiteName, () => {
  describe("setup and formatting", () => {
    it("enriches objects and events with dual time", () => {
      const payload = { key: "value" };
      const enriched = enrichWithDualTime(payload);
      expect(enriched.key).toBe("value");
      expect(enriched._dual_time).toBeDefined();
      expect(enriched._telemetry_id).toBeDefined();

      const extracted = extractDualTime(enriched);
      expect(extracted).not.toBeNull();
      expect(extracted?.utc).toBeDefined();

      const event = {
        schema: "harness-event-v1",
        sequence: 1,
        timestamp: "2026-08-29T12:00:00.000Z",
        actor: "agent",
        kind: "ping",
      };
      const enrichedEvent = enrichHarnessEvent(event);
      expect(enrichedEvent.dual_time).toBeDefined();
    });

    it("renders dual-time markdown header and table formats", () => {
      const header = renderDualTimeHeader("Test Telemetry Header");
      expect(header).toContain("# Test Telemetry Header");
      expect(header).toContain("Generated At");

      const emptyTable = formatDualTimeTable([]);
      expect(emptyTable).toContain("No time telemetry records found");

      const report = buildTimeTelemetryReport([], 0, { runId: "test-run-id" });
      const md = renderOmnipresentTelemetryMarkdown(report);
      expect(md).toContain("Omnipresent Time Telemetry & Dual-Time Report");
      expect(md).toContain("Overview & Statistical Profile");
    });
  });

  describe("core metrics", () => {
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

      const report = buildTimeTelemetryReport(collector.getRecords(), 0, {
        runId: "run-time-test",
      });
      expect(report.runId).toBe("run-time-test");
      expect(report.totalDurationMs).toBeGreaterThanOrEqual(0);

      const health = validateTimeTelemetryHealth(collector.getRecords());
      expect(health.healthy).toBe(true);
    });
  });

  describe("edge cases and anomaly detection", () => {
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
});
