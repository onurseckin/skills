import { describe, expect, it } from "bun:test";
import { getDualTime } from "../../olt/scripts/src/core/dual-time/index.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import {
  OmnipresentTelemetryCollector,
  buildTimeTelemetryReport,
  validateTimeTelemetryHealth,
} from "../../olt/scripts/src/reporting/time-telemetry/collector.ts";
import type { HarnessActionTimeRecord } from "../../olt/scripts/src/reporting/time-telemetry/types.ts";

describe("OmnipresentTelemetryCollector Unit & Coverage Suite", () => {
  it("initializes with optional default timezone and tracks active span counts", () => {
    const collector = new OmnipresentTelemetryCollector({ defaultTimezone: "America/New_York" });
    expect(collector.getActiveSpanCount()).toBe(0);
    expect(collector.getRecords().length).toBe(0);

    const span = collector.startSpan("task:test", "agent-1", { tier: 2 });
    expect(collector.getActiveSpanCount()).toBe(1);
    expect(span.actionName).toBe("task:test");

    const record = collector.finishSpan(span.actionId, "success", { detail: "ok" });
    expect(collector.getActiveSpanCount()).toBe(0);
    expect(record.status).toBe("success");
    expect(record.metadata?.detail).toBe("ok");
  });

  it("throws HarnessError on finishing unknown span ID or recording invalid action record", () => {
    const collector = new OmnipresentTelemetryCollector();

    expect(() => collector.finishSpan("non-existent-span-id")).toThrow(
      /No active action span found with ID: non-existent-span-id/,
    );

    expect(() =>
      collector.recordAction({ invalid: true } as unknown as HarnessActionTimeRecord),
    ).toThrow(/Invalid HarnessActionTimeRecord provided/);
  });

  it("records direct actions and spans with custom statuses and timestamps", () => {
    const collector = new OmnipresentTelemetryCollector();
    const span = collector.startSpan("custom:action", "tester");
    const customTime = new Date("2026-09-01T12:00:00.000Z");
    const record = collector.finishSpan(span.actionId, "failure", { reason: "err" }, customTime);

    expect(record.status).toBe("failure");
    expect(collector.getRecords().length).toBe(1);

    const validRecord: HarnessActionTimeRecord = {
      actionId: "custom-id-1",
      actionName: "manual:log",
      category: "mind",
      actor: "auditor",
      tier: 0,
      status: "success",
      startedAt: getDualTime(customTime),
      durationMs: 100,
    };

    collector.recordAction(validRecord);
    expect(collector.getRecords().length).toBe(2);
  });

  it("records command executions accurately for success and failure exit codes", () => {
    const collector = new OmnipresentTelemetryCollector();
    const start = "2026-09-01T10:00:00.000Z";
    const finish = "2026-09-01T10:00:05.000Z";

    const recSuccess = collector.recordCommandExecution("bun test", "runner", start, finish, 0, {
      extra: "foo",
    });
    expect(recSuccess.status).toBe("success");
    expect(recSuccess.category).toBe("run");
    expect(recSuccess.actionName).toBe("run:exec");
    expect(recSuccess.metadata?.command).toBe("bun test");
    expect(recSuccess.metadata?.exitCode).toBe(0);
    expect(recSuccess.metadata?.extra).toBe("foo");

    const recFail = collector.recordCommandExecution("bun build", "runner", start, finish, 1);
    expect(recFail.status).toBe("failure");
    expect(recFail.metadata?.exitCode).toBe(1);
  });

  it("records gate executions accurately for passed and failed conditions", () => {
    const collector = new OmnipresentTelemetryCollector();
    const start = new Date("2026-09-01T11:00:00.000Z");
    const finish = new Date("2026-09-01T11:00:02.000Z");

    const recPass = collector.recordGateExecution("bun gate.ts", "verifier", start, finish, true, {
      scope: "tests",
    });
    expect(recPass.status).toBe("success");
    expect(recPass.category).toBe("gate");
    expect(recPass.actionName).toBe("gate:check");
    expect(recPass.metadata?.passed).toBe(true);

    const recFail = collector.recordGateExecution("bun gate.ts", "verifier", start, finish, false);
    expect(recFail.status).toBe("failure");
    expect(recFail.metadata?.passed).toBe(false);
  });

  it("records watchdog heartbeats and calculates clock drift", () => {
    const collector = new OmnipresentTelemetryCollector({ defaultTimezone: "UTC" });
    const expectedTickMs = Date.parse("2026-09-01T12:00:00.000Z");
    const actualTick = new Date("2026-09-01T12:00:00.250Z");

    const rec = collector.recordWatchdogHeartbeat(
      "liveness",
      "watchdog-daemon",
      5000,
      expectedTickMs,
      actualTick,
      { ping: true },
    );

    expect(rec.actionName).toBe("watchdog:heartbeat:liveness");
    expect(rec.category).toBe("watchdog");
    expect(rec.tier).toBe(1);
    expect(rec.status).toBe("success");
    expect(rec.durationMs).toBe(0);
    expect(rec.driftMs).toBe(250);
    expect(rec.metadata?.component).toBe("liveness");
    expect(rec.metadata?.ping).toBe(true);

    // Default actualTick branch (new Date())
    const defaultRec = collector.recordWatchdogHeartbeat(
      "default-probe",
      "daemon",
      1000,
      Date.now(),
    );
    expect(defaultRec.actionName).toBe("watchdog:heartbeat:default-probe");
  });

  it("filters records by category, actor (case-insensitive), tier, status, actionName, and time bounds", () => {
    const collector = new OmnipresentTelemetryCollector();
    const baseTime = Date.parse("2026-09-01T12:00:00.000Z");

    collector.recordCommandExecution("cmd1", "Agent-Alice", baseTime, baseTime + 1000, 0);
    collector.recordGateExecution("gate1", "Agent-Bob", baseTime + 2000, baseTime + 3000, true);
    collector.recordWatchdogHeartbeat(
      "watch1",
      "Agent-Alice",
      5000,
      baseTime + 4000,
      baseTime + 4000,
    );

    // No filter
    expect(collector.getRecords().length).toBe(3);

    // Category filter: single and array
    expect(collector.getRecords({ category: "run" }).length).toBe(1);
    expect(collector.getRecords({ category: ["run", "gate"] }).length).toBe(2);

    // Actor filter: case-insensitive single and array
    expect(collector.getRecords({ actor: "agent-alice" }).length).toBe(2);
    expect(collector.getRecords({ actor: ["agent-bob", "agent-alice"] }).length).toBe(3);

    // Tier filter
    expect(collector.getRecords({ tier: 3 }).length).toBe(2);
    expect(collector.getRecords({ tier: [1, 3] }).length).toBe(3);

    // Status filter
    expect(collector.getRecords({ status: "success" }).length).toBe(3);
    expect(collector.getRecords({ status: ["failure"] }).length).toBe(0);

    // Action name filter
    expect(collector.getRecords({ actionName: "run:exec" }).length).toBe(1);
    expect(collector.getRecords({ actionName: ["run:exec", "gate:check"] }).length).toBe(2);

    // Time window filter: fromMs and toMs
    expect(collector.getRecords({ fromMs: baseTime + 1500 }).length).toBe(2);
    expect(collector.getRecords({ toMs: baseTime + 2500 }).length).toBe(2);
    expect(collector.getRecords({ fromMs: baseTime + 1500, toMs: baseTime + 2500 }).length).toBe(1);
  });

  it("generates time telemetry report and clears active spans and records", () => {
    const collector = new OmnipresentTelemetryCollector({ defaultTimezone: "UTC" });
    collector.startSpan("span-active", "agent-x");
    collector.recordCommandExecution("cmd", "agent-x", Date.now() - 1000, Date.now(), 0);

    const report = collector.generateReport({ runId: "test-run-123" });
    expect(report.runId).toBe("test-run-123");
    expect(report.activeActions).toBe(1);
    expect(report.completedActions).toBe(1);
    expect(report.recentActions.length).toBe(1);

    // Test re-exported helpers
    expect(typeof buildTimeTelemetryReport).toBe("function");
    expect(typeof validateTimeTelemetryHealth).toBe("function");
    const health = validateTimeTelemetryHealth(collector.getRecords());
    expect(health.healthy).toBe(true);

    // Test report generation without defaultTimezone
    const noTzCollector = new OmnipresentTelemetryCollector();
    const repNoTz = noTzCollector.generateReport();
    expect(repNoTz.recentActions.length).toBe(0);

    collector.clear();
    expect(collector.getActiveSpanCount()).toBe(0);
    expect(collector.getRecords().length).toBe(0);
  });
});
