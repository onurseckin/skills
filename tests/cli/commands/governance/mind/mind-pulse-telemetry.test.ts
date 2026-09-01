import { describe, expect, test } from "bun:test";
import {
  computeMindCognitiveTelemetry,
  formatMindPulseActiveBrief,
  formatMindPulseOpenedBrief,
  formatPulseDirective,
} from "../../../../../olt/scripts/src/cli/commands/mind-pulse.ts";
import { handleOpenPulseTelemetry } from "../../../../../olt/scripts/src/cli/commands/mind-pulse-telemetry.ts";

describe("mind-pulse formatters", () => {
  test("formatPulseDirective returns discovery proposal text when activeRuns=0 and pendingBacklog=0", () => {
    const directive = formatPulseDirective({
      activeRuns: 0,
      pendingBacklog: 0,
    });
    expect(directive).toContain("MODE A AUTONOMOUS DISCOVERY REQUIRED");
    expect(directive).toContain("CLOSING_FORBIDDEN_FOR_MIND");

    const emptyDirective = formatPulseDirective({
      activeRuns: 1,
      pendingBacklog: 0,
    });
    expect(emptyDirective).toBe("");
  });

  test("formatMindPulseActiveBrief and formatMindPulseOpenedBrief format complete briefs", () => {
    const activeMd = formatMindPulseActiveBrief({
      pulseId: "pulse-1",
      runRoot: ".olt/capsules/run-1",
      actor: "mind-1",
      host: "local",
      driver: "perpetual-loop",
      openedAt: "2026-08-31T00:00:00Z",
      deadlineAt: "2026-08-31T01:00:00Z",
      scheduledIntervalMs: 60000,
      nextWakeAt: "2026-08-31T00:01:00Z",
      pulsesToday: 5,
      pulsesPerDay: null,
      cliReceiptSummaryBadge: "2/2 PASS",
      workSpan: {
        total_work: 10,
        span: 2,
        parallelism_factor: 5,
        optimal_concurrency: 4,
        active_concurrency: 2,
      },
      activeAgents: [
        {
          agent_id: "worker-1",
          role: "implementer",
          host: "local",
          task_id: "T-1",
          wave: 1,
          lane: 1,
          coordinate_badge: "[⚡ LEASED: worker-1 (implementer) @ T-1 [W1:L1]]",
        },
      ],
      waveLanes: [
        {
          wave: 1,
          lane_count: 1,
          status: "leased",
          is_active: true,
        },
      ],
      dagBadges: ["T-1:leased"],
      activeRuns: 1,
      pendingBacklog: 0,
    });

    expect(activeMd).toContain("Mind Pulse Active: pulse-1");
    expect(activeMd).toContain("5 / ∞ pulses today");
    expect(activeMd).toContain("- **CLI Diagnostics Receipts**: 2/2 PASS");
    expect(activeMd).toContain("- **Work/Span Concurrency**: Work=10, Span=2");
    expect(activeMd).toContain("- **Wave Lanes**: Wave 1: 1 lane(s) [leased] ⚡");

    const openedMd = formatMindPulseOpenedBrief({
      pulseId: "pulse-2",
      runRoot: ".olt/capsules/run-1",
      actor: "mind-1",
      host: "local",
      driver: "perpetual-loop",
      openedAt: "2026-08-31T00:00:00Z",
      deadlineAt: "2026-08-31T01:00:00Z",
      scheduledIntervalMs: 60000,
      nextWakeAt: "2026-08-31T00:01:00Z",
      pulsesToday: 1,
      pulsesPerDay: 50,
      cliReceiptSummaryBadge: "1/1 PASS",
      workSpan: {
        total_work: 5,
        span: 1,
        parallelism_factor: 5,
        optimal_concurrency: 2,
        active_concurrency: 1,
      },
      activeAgents: [
        {
          agent_id: "worker-2",
          role: "validator",
          host: "local",
          task_id: "T-2",
          wave: 1,
          lane: 1,
          coordinate_badge: "[⚡ VALIDATING: worker-2 (validator) @ T-2 [W1:L1]]",
        },
      ],
      waveLanes: [
        {
          wave: 1,
          lane_count: 1,
          status: "validating",
          is_active: true,
        },
      ],
      dagBadges: ["T-2:validating"],
      activeRuns: 1,
      pendingBacklog: 1,
    });

    expect(openedMd).toContain("Mind Pulse Opened: pulse-2");
    expect(openedMd).toContain("1 / 50 pulses today");
    expect(openedMd).toContain("- **Work/Span Concurrency**");
  });
});

describe("computeMindCognitiveTelemetry", () => {
  test("computes telemetry from compiled workflow state with tasks and active agent mapping", () => {
    const state = {
      graph: { revision: 1 },
      tasks: {
        "T-1": {
          id: "T-1",
          status: "leased",
          dependencies: [],
          effort: 2,
          lease: {
            agent_id: "worker-impl",
            role: "implementer",
          },
        },
        "T-2": {
          id: "T-2",
          status: "validating",
          dependencies: ["T-1"],
          effort: 3,
        },
        "T-3": {
          id: "T-3",
          status: "proposed",
          dependencies: ["T-1"],
          effort: 1,
        },
      },
      agents: [
        {
          id: "worker-impl",
          role: "implementer",
          host: "local",
          status: "active",
        },
        {
          id: "worker-val",
          role: "validator",
          host: "local",
          parent_task_id: "T-2",
          status: "active",
        },
        {
          id: "standby-agent",
          role: "coordinator",
          host: "local",
          status: "active",
        },
      ],
    };

    const telemetry = computeMindCognitiveTelemetry(state);
    expect(telemetry.workSpan.total_work).toBe(6);
    expect(telemetry.workSpan.span).toBe(2);
    expect(telemetry.activeAgents.length).toBe(3);
    expect(telemetry.waveLanes.length).toBe(2);
    expect(telemetry.waveLanes[0]!.is_active).toBe(true);
  });

  test("computes telemetry from planning_buffer when uncompiled", () => {
    const state = {
      planning_buffer: [
        { id: "P-1", deps: [], effort: 2 },
        { id: "P-2", deps: ["P-1"], effort: 4 },
      ],
      agents: [],
    };

    const telemetry = computeMindCognitiveTelemetry(state);
    expect(telemetry.workSpan.total_work).toBe(6);
    expect(telemetry.workSpan.span).toBe(2);
    expect(telemetry.activeAgents).toEqual([]);
  });

  test("handles empty state and cyclic dependencies safely", () => {
    const state = {
      graph: { revision: 1 },
      tasks: {
        "T-A": { id: "T-A", dependencies: ["T-B"], effort: 1, status: "proposed" },
        "T-B": { id: "T-B", dependencies: ["T-A"], effort: 1, status: "proposed" },
      },
      agents: [],
    };

    const telemetry = computeMindCognitiveTelemetry(state);
    expect(telemetry.workSpan.total_work).toBe(2);
    expect(telemetry.workSpan.span).toBe(1);
  });
});

describe("handleOpenPulseTelemetry", () => {
  test("throws HarnessError when open pulse is past deadline", async () => {
    await expect(
      handleOpenPulseTelemetry({
        run: ".olt/capsules/run-1",
        actor: "mind-1",
        host: "local",
        driver: "perpetual-loop",
        nowMs: Date.parse("2026-08-31T02:00:00Z"),
        state: {},
        openPulse: {
          pulse_id: "pulse-old",
          opened_at: "2026-08-31T00:00:00Z",
          deadline_at: "2026-08-31T01:00:00Z",
        },
        pulseState: {},
        budgetRecord: {},
        baseIntervalMs: 60000,
        pulsesPerDay: 50,
        wallClockPerDay: 3600000,
      }),
    ).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
  });

  test("returns valid MindPulseResult for active open pulse with arm override", async () => {
    const nowMs = Date.parse("2026-08-31T00:30:00Z");
    const result = await handleOpenPulseTelemetry({
      run: ".olt/capsules/run-1",
      actor: "mind-1",
      host: "local",
      driver: "perpetual-loop",
      arm: "30s",
      nowMs,
      state: {
        tasks: {},
        planning_buffer: [],
      },
      openPulse: {
        pulse_id: "pulse-open",
        opened_at: "2026-08-31T00:00:00Z",
        deadline_at: "2026-08-31T01:00:00Z",
      },
      pulseState: {
        last: { zero_value_streak: 2 },
      },
      budgetRecord: {
        pulses_today: 3,
        wall_clock_ms_today: 1800000,
      },
      baseIntervalMs: 60000,
      pulsesPerDay: 50,
      wallClockPerDay: 3600000,
    });

    expect(result.status).toBe("active");
    expect(result.scheduled_interval_ms).toBe(30000);
    expect(result.zero_value_streak).toBe(2);
    expect(result.budget.pulses_today).toBe(3);
  });
});
