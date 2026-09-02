import { describe, expect, it } from "bun:test";
import type { HarnessEvent } from "../../olt/scripts/src/core/contracts/index.ts";
import { getDualTime, isDualTimeRecord } from "../../olt/scripts/src/core/dual-time/index.ts";
import {
  enrichHarnessEvent,
  enrichWithDualTime,
  extractDualTime,
  formatDualTimeTable,
  renderDualTimeHeader,
  renderOmnipresentTelemetryMarkdown,
} from "../../olt/scripts/src/reporting/time-telemetry/dual-time.ts";
import type {
  HarnessActionTimeRecord,
  TimeTelemetryReport,
} from "../../olt/scripts/src/reporting/time-telemetry/types.ts";

describe("Reporting Time Telemetry - Dual Time Coverage", () => {
  it("enriches payload with dual time record and telemetry ID", () => {
    const payload = { task: "compute-hash", count: 42 };
    const enriched = enrichWithDualTime(payload, "America/New_York");

    expect(enriched.task).toBe("compute-hash");
    expect(enriched.count).toBe(42);
    expect(isDualTimeRecord(enriched._dual_time)).toBe(true);
    expect(typeof enriched._telemetry_id).toBe("string");
    expect(enriched._telemetry_id.length).toBeGreaterThan(10);
  });

  it("enriches harness event with dual time record", () => {
    const event: HarnessEvent = {
      sequence: 1,
      timestamp: "2026-09-01T12:00:00.000Z",
      actor: "tester",
      kind: "task_started",
      payload: { key: "val" },
    };

    const enriched = enrichHarnessEvent(event, "UTC");
    expect(enriched.actor).toBe("tester");
    expect(isDualTimeRecord(enriched.dual_time)).toBe(true);
    expect(enriched.dual_time.utc).toBe("2026-09-01T12:00:00.000Z");
  });

  it("extracts dual time from various record structures or fallbacks to null", () => {
    expect(extractDualTime(null)).toBeNull();
    expect(extractDualTime(undefined)).toBeNull();
    expect(extractDualTime("string")).toBeNull();
    expect(extractDualTime(12345)).toBeNull();

    const direct = getDualTime("2026-09-01T10:00:00.000Z");
    expect(extractDualTime(direct)).toEqual(direct);

    expect(extractDualTime({ _dual_time: direct })).toEqual(direct);
    expect(extractDualTime({ dual_time: direct })).toEqual(direct);
    expect(extractDualTime({ timestamp: direct })).toEqual(direct);

    const fromTimestampStr = extractDualTime({ timestamp: "2026-09-01T15:30:00.000Z" });
    expect(fromTimestampStr?.utc).toBe("2026-09-01T15:30:00.000Z");

    const fromCreatedAtStr = extractDualTime({ created_at: "2026-09-01T16:00:00.000Z" });
    expect(fromCreatedAtStr?.utc).toBe("2026-09-01T16:00:00.000Z");

    expect(extractDualTime({ timestamp: "not-a-valid-date-string" })).toBeNull();
    expect(extractDualTime({ unrelatedField: true })).toBeNull();
  });

  it("renders dual time header with or without provided record", () => {
    const custom = getDualTime("2026-09-01T12:00:00.000Z", "UTC");
    const header = renderDualTimeHeader("Test Suite Execution", custom);
    expect(header).toContain("# Test Suite Execution");
    expect(header).toContain("Generated At");
    expect(header).toContain("2026-09-01T12:00:00.000Z");

    const defaultHeader = renderDualTimeHeader("Live Telemetry");
    expect(defaultHeader).toContain("# Live Telemetry");
  });

  it("formats dual time table across all execution statuses and options", () => {
    expect(formatDualTimeTable([])).toBe("_No time telemetry records found._\n");

    const t = getDualTime("2026-09-01T12:00:00.000Z", "UTC");
    const records: HarnessActionTimeRecord[] = [
      {
        actionId: "a1",
        actionName: "build",
        category: "task",
        actor: "agent-1",
        tier: 1,
        status: "success",
        startedAt: t,
        durationMs: 120,
        driftMs: 5,
      },
      {
        actionId: "a2",
        actionName: "verify",
        category: "doctor",
        actor: "agent-2",
        tier: 2,
        status: "running",
        startedAt: t,
        durationFormatted: "1m 30s",
        driftMs: -2,
      },
      {
        actionId: "a3",
        actionName: "lint",
        category: "gate",
        actor: "agent-1",
        tier: 1,
        status: "failure",
        startedAt: t,
        durationMs: 45,
      },
      {
        actionId: "a4",
        actionName: "test",
        category: "run",
        actor: "agent-3",
        tier: 3,
        status: "error",
        startedAt: t,
      },
      {
        actionId: "a5",
        actionName: "deploy",
        category: "workflow",
        actor: "agent-1",
        tier: 1,
        status: "timed_out",
        startedAt: t,
      },
      {
        actionId: "a6",
        actionName: "queue-job",
        category: "queue",
        actor: "agent-2",
        tier: 2,
        status: "pending",
        startedAt: t,
      },
    ];

    const table = formatDualTimeTable(records, { maxRows: 3 });
    expect(table).toContain(
      "| Action | Category | Actor | Tier | Status | Started (Local) | Duration | Drift |",
    );
    expect(table).toContain("✅ success");
    expect(table).toContain("🏃 running");
    expect(table).toContain("❌ failure");
    expect(table).toContain("+5ms");
    expect(table).toContain("-2ms");
    expect(table).toContain("_... showing 3 of 6 records._");

    const fullTable = formatDualTimeTable(records);
    expect(fullTable).toContain("💥 error");
    expect(fullTable).toContain("⏰ timed_out");
    expect(fullTable).toContain("⏳ pending");
  });

  it("renders omnipresent telemetry markdown report with breakdowns and anomalies", () => {
    const genTime = getDualTime("2026-09-01T12:00:00.000Z", "UTC");
    const samplePercentiles = {
      count: 10,
      minMs: 10,
      maxMs: 500,
      meanMs: 150,
      p50Ms: 120,
      p90Ms: 350,
      p95Ms: 400,
      p99Ms: 480,
    };

    const report: TimeTelemetryReport = {
      generatedAt: genTime,
      timezone: "UTC",
      totalActions: 25,
      activeActions: 5,
      completedActions: 20,
      totalDurationMs: 15000,
      overallPercentiles: samplePercentiles,
      categoryBreakdown: [
        {
          category: "task",
          count: 15,
          successCount: 14,
          failureCount: 1,
          errorRate: 6.7,
          totalDurationMs: 9000,
          meanDurationMs: 600,
          maxDurationMs: 1200,
          percentiles: samplePercentiles,
        },
      ],
      actorBreakdown: [
        {
          actor: "lead-coordinator",
          tier: 1,
          count: 12,
          totalDurationMs: 8000,
          meanDurationMs: 666,
          errorCount: 0,
        },
      ],
      anomalies: [
        {
          type: "excessive_duration",
          severity: "critical",
          actionId: "a1",
          actionName: "deep-scan",
          actor: "worker-1",
          message: "Exceeded 10s budget",
        },
        {
          type: "clock_drift",
          severity: "high",
          actionId: "a2",
          actionName: "sync-clock",
          actor: "worker-2",
          message: "Clock skew +250ms",
        },
        {
          type: "unclosed_substep",
          severity: "medium",
          actionId: "a3",
          actionName: "sub-step",
          actor: "worker-3",
          message: "Unclosed span",
        },
        {
          type: "orphaned_span",
          severity: "low",
          actionId: "a4",
          actionName: "orphan",
          actor: "worker-4",
          message: "Orphaned action",
        },
      ],
      recentActions: [
        {
          actionId: "r1",
          actionName: "git-commit",
          category: "workflow",
          actor: "lead",
          tier: 1,
          status: "success",
          startedAt: genTime,
          durationMs: 250,
        },
      ],
    };

    const markdown = renderOmnipresentTelemetryMarkdown(report);
    expect(markdown).toContain("Omnipresent Time Telemetry & Dual-Time Report");
    expect(markdown).toContain("## Overview & Statistical Profile");
    expect(markdown).toContain("## Domain Category Breakdown");
    expect(markdown).toContain("## Agent & Authority Tier Breakdown");
    expect(markdown).toContain("## Temporal Invariant & Health Anomalies");
    expect(markdown).toContain("🚨 CRITICAL");
    expect(markdown).toContain("⚠️ HIGH");
    expect(markdown).toContain("⚡ MEDIUM");
    expect(markdown).toContain("ℹ️ LOW");
    expect(markdown).toContain("## Recent Telemetry Activity Stream");
    expect(markdown).toContain("`git-commit`");

    const emptyReport: TimeTelemetryReport = {
      generatedAt: genTime,
      timezone: "UTC",
      totalActions: 0,
      activeActions: 0,
      completedActions: 0,
      totalDurationMs: 0,
      overallPercentiles: {
        count: 0,
        minMs: 0,
        maxMs: 0,
        meanMs: 0,
        p50Ms: 0,
        p90Ms: 0,
        p95Ms: 0,
        p99Ms: 0,
      },
      categoryBreakdown: [],
      actorBreakdown: [],
      anomalies: [],
      recentActions: [],
    };

    const emptyMarkdown = renderOmnipresentTelemetryMarkdown(emptyReport);
    expect(emptyMarkdown).toContain("## Overview & Statistical Profile");
    expect(emptyMarkdown).not.toContain("## Domain Category Breakdown");
    expect(emptyMarkdown).not.toContain("## Temporal Invariant & Health Anomalies");
  });
});
