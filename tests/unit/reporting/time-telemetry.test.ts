import { describe, expect, test } from "bun:test";
import type { HarnessEvent } from "../../../olt/scripts/src/core/contracts/index.ts";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/index.ts";
import { getDualTime, isDualTimeRecord } from "../../../olt/scripts/src/core/dual-time/index.ts";
import {
  ActionSpan,
  categorizeHarnessAction,
  computeLatencyPercentiles,
  enrichHarnessEvent,
  enrichWithDualTime,
  extractDualTime,
  formatDualTimeTable,
  HARNESS_ACTION_CATEGORIES,
  isActionExecutionStatus,
  isHarnessActionCategory,
  isHarnessActionTimeRecord,
  isTimeTelemetryHealthResult,
  isTimeTelemetryReport,
  OmnipresentTelemetryCollector,
  renderDualTimeHeader,
  renderOmnipresentTelemetryMarkdown,
  validateTimeTelemetryHealth,
  type HarnessActionTimeRecord,
} from "../../../olt/scripts/src/reporting/time-telemetry.ts";

describe("Omnipresent Time Telemetry - Action Categorization", () => {
  test("categorizeHarnessAction correctly maps command prefixes to categories and tiers", () => {
    expect(categorizeHarnessAction("mind:pulse")).toEqual({ category: "mind", defaultTier: 0 });
    expect(categorizeHarnessAction("memory:query")).toEqual({ category: "mind", defaultTier: 0 });
    expect(categorizeHarnessAction("smart-task:plan")).toEqual({
      category: "mind",
      defaultTier: 0,
    });
    expect(categorizeHarnessAction("orchestrate")).toEqual({ category: "plan", defaultTier: 1 });
    expect(categorizeHarnessAction("plan:compile")).toEqual({ category: "plan", defaultTier: 2 });
    expect(categorizeHarnessAction("dag:view")).toEqual({ category: "plan", defaultTier: 2 });
    expect(categorizeHarnessAction("queue:wave")).toEqual({ category: "queue", defaultTier: 2 });
    expect(categorizeHarnessAction("task:claim")).toEqual({ category: "task", defaultTier: 3 });
    expect(categorizeHarnessAction("task:submit")).toEqual({ category: "task", defaultTier: 3 });
    expect(categorizeHarnessAction("run:exec")).toEqual({ category: "run", defaultTier: 3 });
    expect(categorizeHarnessAction("doctor")).toEqual({ category: "doctor", defaultTier: 1 });
    expect(categorizeHarnessAction("doctor:repair")).toEqual({
      category: "doctor",
      defaultTier: 1,
    });
    expect(categorizeHarnessAction("watchdog:heartbeat")).toEqual({
      category: "watchdog",
      defaultTier: 1,
    });
    expect(categorizeHarnessAction("heartbeat")).toEqual({ category: "watchdog", defaultTier: 1 });
    expect(categorizeHarnessAction("subagent:spawn")).toEqual({
      category: "subagent",
      defaultTier: 3,
    });
    expect(categorizeHarnessAction("gate:check")).toEqual({ category: "gate", defaultTier: 3 });
    expect(categorizeHarnessAction("workflow:export")).toEqual({
      category: "workflow",
      defaultTier: 2,
    });
    expect(categorizeHarnessAction("custom_operation")).toEqual({
      category: "custom",
      defaultTier: 3,
    });
  });

  test("HARNESS_ACTION_CATEGORIES contains all required canonical domains", () => {
    expect(HARNESS_ACTION_CATEGORIES).toContain("plan");
    expect(HARNESS_ACTION_CATEGORIES).toContain("queue");
    expect(HARNESS_ACTION_CATEGORIES).toContain("task");
    expect(HARNESS_ACTION_CATEGORIES).toContain("run");
    expect(HARNESS_ACTION_CATEGORIES).toContain("doctor");
    expect(HARNESS_ACTION_CATEGORIES).toContain("mind");
    expect(HARNESS_ACTION_CATEGORIES).toContain("watchdog");
    expect(HARNESS_ACTION_CATEGORIES).toContain("subagent");
    expect(HARNESS_ACTION_CATEGORIES).toContain("gate");
    expect(HARNESS_ACTION_CATEGORIES).toContain("workflow");
    expect(HARNESS_ACTION_CATEGORIES).toContain("custom");
  });
});

describe("Omnipresent Time Telemetry - ActionSpan Lifecycle", () => {
  test("ActionSpan initializes with dual-time stamp and default category/tier", () => {
    const span = new ActionSpan("task:claim", "implementer_1", {
      timezone: "America/Los_Angeles",
      metadata: { taskId: "task-01" },
    });

    expect(span.actionName).toBe("task:claim");
    expect(span.category).toBe("task");
    expect(span.actor).toBe("implementer_1");
    expect(span.tier).toBe(3);
    expect(span.status).toBe("running");
    expect(span.timezone).toBe("America/Los_Angeles");
    expect(isDualTimeRecord(span.startedAt)).toBe(true);
    expect(span.metadata.taskId).toBe("task-01");
  });

  test("ActionSpan calculates drift when expectedStartMs is provided", () => {
    const expected = 1787391000000;
    const actual = 1787391005000; // 5s later
    const span = new ActionSpan("watchdog:tick", "watchdog_daemon", {
      startedAt: actual,
      expectedStartMs: expected,
    });

    expect(span.driftMs).toBe(5000);
  });

  test("ActionSpan tracks internal sub-step timing correctly", () => {
    const startMs = 1787391000000;
    const step1StartMs = 1787391001000;
    const step1EndMs = 1787391003000;
    const finishMs = 1787391005000;

    const span = new ActionSpan("run:exec", "worker_subagent", { startedAt: startMs });
    span.startSubStep("compile_phase", { opt: true }, step1StartMs);
    span.finishSubStep("success", { outputBytes: 1024 }, step1EndMs);

    const record = span.finish("success", { completed: true }, finishMs);

    expect(record.status).toBe("success");
    expect(record.durationMs).toBe(5000);
    expect(record.durationFormatted).toBe("5.00s");
    expect(record.subSteps?.length).toBe(1);

    const sub = record.subSteps![0]!;
    expect(sub.name).toBe("compile_phase");
    expect(sub.durationMs).toBe(2000);
    expect(sub.durationFormatted).toBe("2.00s");
    expect(sub.status).toBe("success");
    expect(sub.details?.outputBytes).toBe(1024);
  });

  test("ActionSpan handles failure with fail() method and records error", () => {
    const span = new ActionSpan("task:submit", "implementer_2", { startedAt: 1787391000000 });
    const record = span.fail(new Error("Lease expired"), { attempt: 2 }, 1787391002500);

    expect(record.status).toBe("error");
    expect(record.error).toBe("Lease expired");
    expect(record.durationMs).toBe(2500);
    expect(record.metadata?.error).toBe("Lease expired");
    expect(record.metadata?.attempt).toBe(2);
  });
});

describe("Omnipresent Time Telemetry - Latency Percentiles", () => {
  test("computeLatencyPercentiles handles empty array gracefully", () => {
    const result = computeLatencyPercentiles([]);
    expect(result.count).toBe(0);
    expect(result.minMs).toBe(0);
    expect(result.maxMs).toBe(0);
    expect(result.p50Ms).toBe(0);
  });

  test("computeLatencyPercentiles computes accurate percentiles across sample distribution", () => {
    const latencies = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const stats = computeLatencyPercentiles(latencies);

    expect(stats.count).toBe(10);
    expect(stats.minMs).toBe(10);
    expect(stats.maxMs).toBe(100);
    expect(stats.meanMs).toBe(55);
    expect(stats.p50Ms).toBe(50);
    expect(stats.p90Ms).toBe(90);
    expect(stats.p95Ms).toBe(100);
    expect(stats.p99Ms).toBe(100);
  });
});

describe("Omnipresent Time Telemetry - OmnipresentTelemetryCollector", () => {
  test("Collector records spans, finishes them, and stores history", () => {
    const collector = new OmnipresentTelemetryCollector({ defaultTimezone: "UTC" });

    const span = collector.startSpan("task:claim", "worker_1");
    expect(collector.getActiveSpanCount()).toBe(1);

    const record = collector.finishSpan(span.actionId, "success", { leaseToken: "tok_123" });
    expect(collector.getActiveSpanCount()).toBe(0);
    expect(record.actionName).toBe("task:claim");
    expect(collector.getRecords().length).toBe(1);
  });

  test("Collector throws error when finishing unknown span ID", () => {
    const collector = new OmnipresentTelemetryCollector();
    expect(() => collector.finishSpan("unknown_id")).toThrow();
  });

  test("Collector records convenience methods: command, gate, and watchdog", () => {
    const collector = new OmnipresentTelemetryCollector();

    collector.recordCommandExecution("bun test", "tester", 1000, 2500, 0, { suite: "unit" });
    collector.recordGateExecution("bun test gate", "validator", 3000, 5000, true);
    collector.recordWatchdogHeartbeat("autonomic_watchdog", "watchdog_agent", 180000, 10000, 10050);

    const records = collector.getRecords();
    expect(records.length).toBe(3);

    const cmdRec = records[0]!;
    expect(cmdRec.actionName).toBe("run:exec");
    expect(cmdRec.durationMs).toBe(1500);
    expect(cmdRec.status).toBe("success");

    const gateRec = records[1]!;
    expect(gateRec.actionName).toBe("gate:check");
    expect(gateRec.durationMs).toBe(2000);
    expect(gateRec.status).toBe("success");

    const wdRec = records[2]!;
    expect(wdRec.actionName).toBe("watchdog:heartbeat:autonomic_watchdog");
    expect(wdRec.driftMs).toBe(50);
  });

  test("Collector filters records accurately by category, actor, tier, and status", () => {
    const collector = new OmnipresentTelemetryCollector();

    collector.recordAction({
      actionId: "1",
      actionName: "mind:pulse",
      category: "mind",
      actor: "mind_root",
      tier: 0,
      status: "success",
      startedAt: getDualTime(1000),
      finishedAt: getDualTime(1200),
      durationMs: 200,
    });
    collector.recordAction({
      actionId: "2",
      actionName: "task:claim",
      category: "task",
      actor: "worker_a",
      tier: 3,
      status: "success",
      startedAt: getDualTime(2000),
      finishedAt: getDualTime(2100),
      durationMs: 100,
    });
    collector.recordAction({
      actionId: "3",
      actionName: "task:submit",
      category: "task",
      actor: "worker_b",
      tier: 3,
      status: "failure",
      startedAt: getDualTime(3000),
      finishedAt: getDualTime(3500),
      durationMs: 500,
    });

    expect(collector.getRecords({ category: "mind" }).length).toBe(1);
    expect(collector.getRecords({ category: "task" }).length).toBe(2);
    expect(collector.getRecords({ actor: "worker_a" }).length).toBe(1);
    expect(collector.getRecords({ tier: 3 }).length).toBe(2);
    expect(collector.getRecords({ status: "failure" }).length).toBe(1);
    expect(collector.getRecords({ fromMs: 2500 }).length).toBe(1);
  });

  test("Collector generates comprehensive report with statistical summaries", () => {
    const collector = new OmnipresentTelemetryCollector({ defaultTimezone: "UTC" });

    collector.recordCommandExecution("bun test 1", "worker_1", 1000, 2000, 0);
    collector.recordCommandExecution("bun test 2", "worker_1", 2500, 4500, 0);
    collector.recordGateExecution("bun test gate", "validator_1", 5000, 6000, true);

    const report = collector.generateReport({ runId: "run-test-01" });

    expect(isTimeTelemetryReport(report)).toBe(true);
    expect(report.runId).toBe("run-test-01");
    expect(report.totalActions).toBe(3);
    expect(report.completedActions).toBe(3);
    expect(report.totalDurationMs).toBe(4000); // 1000 + 2000 + 1000
    expect(report.categoryBreakdown.length).toBeGreaterThan(0);
    expect(report.actorBreakdown.length).toBeGreaterThan(0);
    expect(report.recentActions.length).toBe(3);
  });
});

describe("Omnipresent Time Telemetry - Dual-Time Enrichment", () => {
  test("enrichWithDualTime attaches _dual_time and _telemetry_id to arbitrary JSON payload", () => {
    const payload: JsonObject = { task: "task-01", status: "ready" };
    const enriched = enrichWithDualTime(payload, "America/New_York");

    expect(enriched.task).toBe("task-01");
    expect(enriched.status).toBe("ready");
    expect(typeof enriched._telemetry_id).toBe("string");
    expect(isDualTimeRecord(enriched._dual_time)).toBe(true);
    expect(enriched._dual_time.timezone).toBe("America/New_York");
  });

  test("enrichHarnessEvent attaches dual_time to HarnessEvent", () => {
    const rawEvent: HarnessEvent = {
      schema: "harness.event",
      version: 1,
      run_id: "run-01",
      capsule_id: "cap-01",
      sequence: 42,
      revision: 1,
      timestamp: "2026-08-22T10:00:00.000Z",
      actor: "implementer",
      kind: "task.claimed",
      payload: {},
      previous_hash: null,
      projection: null,
      hash: "abc123hash",
    };

    const enriched = enrichHarnessEvent(rawEvent, "UTC");
    expect(enriched.sequence).toBe(42);
    expect(isDualTimeRecord(enriched.dual_time)).toBe(true);
    expect(enriched.dual_time.utc).toBe("2026-08-22T10:00:00.000Z");
  });

  test("extractDualTime resolves dual-time record from various envelope patterns", () => {
    const directDual = getDualTime();
    expect(extractDualTime(directDual)).toEqual(directDual);

    const wrapped1 = { _dual_time: directDual, other: 123 };
    expect(extractDualTime(wrapped1)).toEqual(directDual);

    const wrapped2 = { dual_time: directDual };
    expect(extractDualTime(wrapped2)).toEqual(directDual);

    const wrapped3 = { timestamp: "2026-08-22T12:00:00.000Z" };
    const extracted = extractDualTime(wrapped3);
    expect(extracted).not.toBeNull();
    expect(extracted?.utc).toBe("2026-08-22T12:00:00.000Z");

    expect(extractDualTime(null)).toBeNull();
    expect(extractDualTime("not_an_object")).toBeNull();
  });
});

describe("Omnipresent Time Telemetry - Health & Anomaly Detection", () => {
  test("validateTimeTelemetryHealth identifies negative duration anomalies", () => {
    const badRecord: HarnessActionTimeRecord = {
      actionId: "bad-1",
      actionName: "run:exec",
      category: "run",
      actor: "worker",
      tier: 3,
      status: "error",
      startedAt: getDualTime(5000),
      finishedAt: getDualTime(2000),
      durationMs: -3000,
    };

    const health = validateTimeTelemetryHealth([badRecord]);
    expect(isTimeTelemetryHealthResult(health)).toBe(true);
    expect(health.healthy).toBe(false);
    expect(health.anomalies.some((a) => a.type === "negative_duration")).toBe(true);
  });

  test("validateTimeTelemetryHealth identifies watchdog clock drift anomalies", () => {
    const driftRecord: HarnessActionTimeRecord = {
      actionId: "drift-1",
      actionName: "watchdog:heartbeat",
      category: "watchdog",
      actor: "supervisory_watchdog",
      tier: 1,
      status: "success",
      startedAt: getDualTime(),
      driftMs: 45000, // 45 seconds drift
    };

    const health = validateTimeTelemetryHealth([driftRecord], { maxDriftMs: 10000 });
    expect(health.healthy).toBe(false);
    expect(health.anomalies.some((a) => a.type === "clock_drift")).toBe(true);
  });

  test("validateTimeTelemetryHealth reports healthy when all records adhere to thresholds", () => {
    const goodRecord: HarnessActionTimeRecord = {
      actionId: "good-1",
      actionName: "task:claim",
      category: "task",
      actor: "implementer",
      tier: 3,
      status: "success",
      startedAt: getDualTime(1000),
      finishedAt: getDualTime(1500),
      durationMs: 500,
      durationFormatted: "500ms",
      driftMs: 10,
    };

    const health = validateTimeTelemetryHealth([goodRecord]);
    expect(health.healthy).toBe(true);
    expect(health.anomalyCount).toBe(0);
  });
});

describe("Omnipresent Time Telemetry - Markdown Rendering", () => {
  test("renderDualTimeHeader produces valid markdown header", () => {
    const header = renderDualTimeHeader(
      "Test Telemetry View",
      getDualTime("2026-08-22T09:30:00.000Z", "UTC"),
    );
    expect(header).toContain("# Test Telemetry View");
    expect(header).toContain("2026-08-22 09:30:00 UTC");
  });

  test("formatDualTimeTable formats action records into table with local timestamps", () => {
    const records: HarnessActionTimeRecord[] = [
      {
        actionId: "1",
        actionName: "task:claim",
        category: "task",
        actor: "implementer_1",
        tier: 3,
        status: "success",
        startedAt: getDualTime("2026-08-22T09:30:00.000Z", "UTC"),
        durationMs: 1200,
        durationFormatted: "1.20s",
      },
    ];

    const table = formatDualTimeTable(records);
    expect(table).toContain(
      "| Action | Category | Actor | Tier | Status | Started (Local) | Duration | Drift |",
    );
    expect(table).toContain("`task:claim`");
    expect(table).toContain("`task`");
    expect(table).toContain("`implementer_1`");
    expect(table).toContain("✅ success");
    expect(table).toContain("1.20s");
  });

  test("renderOmnipresentTelemetryMarkdown generates full structured markdown document", () => {
    const collector = new OmnipresentTelemetryCollector({ defaultTimezone: "UTC" });
    collector.recordCommandExecution("bun test", "worker", 1000, 3000, 0);
    const report = collector.generateReport({ runId: "test-run" });

    const md = renderOmnipresentTelemetryMarkdown(report);
    expect(md).toContain("# Omnipresent Time Telemetry & Dual-Time Report");
    expect(md).toContain("## Overview & Statistical Profile");
    expect(md).toContain("## Domain Category Breakdown");
    expect(md).toContain("## Agent & Authority Tier Breakdown");
    expect(md).toContain("## Recent Telemetry Activity Stream");
  });
});

describe("Omnipresent Time Telemetry - Strict Type Guards", () => {
  test("Type guards validate categories, statuses, records, reports, and health results", () => {
    expect(isHarnessActionCategory("plan")).toBe(true);
    expect(isHarnessActionCategory("unknown_category")).toBe(false);

    expect(isActionExecutionStatus("success")).toBe(true);
    expect(isActionExecutionStatus("invalid_status")).toBe(false);

    const validRecord: HarnessActionTimeRecord = {
      actionId: "rec-1",
      actionName: "plan:compile",
      category: "plan",
      actor: "coordinator",
      tier: 2,
      status: "success",
      startedAt: getDualTime(),
    };
    expect(isHarnessActionTimeRecord(validRecord)).toBe(true);
    expect(isHarnessActionTimeRecord({ actionId: 123 })).toBe(false);

    const collector = new OmnipresentTelemetryCollector();
    const report = collector.generateReport();
    expect(isTimeTelemetryReport(report)).toBe(true);
    expect(isTimeTelemetryReport("not a report")).toBe(false);

    const health = validateTimeTelemetryHealth([]);
    expect(isTimeTelemetryHealthResult(health)).toBe(true);
    expect(isTimeTelemetryHealthResult(null)).toBe(false);
  });

  test("exercises ActionSpan getters and clear method", () => {
    const span = new ActionSpan("task:exec", "impl-1", {
      metadata: { key: "val" },
    });

    expect(span.status).toBe("running");
    expect(span.finishedAt).toBeUndefined();
    expect(span.durationMs).toBeUndefined();
    expect(span.durationFormatted).toBeUndefined();
    expect(span.error).toBeUndefined();
    expect(span.metadata).toEqual({ key: "val" });
    expect(span.subSteps).toEqual([]);

    span.startSubStep("sub1", { step: 1 });
    span.finishSubStep("success");
    expect(span.subSteps.length).toBe(1);

    span.finish("success");
    expect(span.status).toBe("success");
    expect(span.finishedAt).toBeDefined();
    expect(span.durationMs).toBeGreaterThanOrEqual(0);
    expect(span.durationFormatted).toBeDefined();

    const collector = new OmnipresentTelemetryCollector();
    collector.recordCommandExecution("bun test", "worker", 1000, 2000, 0);
    expect(collector.generateReport().completedActions).toBe(1);
    collector.clear();
    expect(collector.generateReport().completedActions).toBe(0);
  });
});
