import { describe, expect, it } from "bun:test";
import {
  buildSchedulerLivePushReport,
  formatSchedulerLivePushMarkdown,
} from "../../olt/scripts/src/engine/scheduler/reporting/live-push-emitter.ts";

describe("live-push-emitter coverage suite", () => {
  it("builds comprehensive live push report with previousState, budget, actor, host, pulseId", () => {
    const prevState: Record<string, unknown> = {
      run_id: "run-001",
      tasks: {
        t1: { status: "ready" },
        t2: { status: "proposed" },
      },
    };

    const currState: Record<string, unknown> = {
      run_id: "run-001",
      tasks: {
        t1: { status: "completed" },
        t2: { status: "leased", lease: { agent_id: "ag-worker", role: "coder" } },
        t3: { status: "ready" },
        t4: { status: "failed" },
      },
      agents: [
        { id: "ag-worker", role: "coder", host: "mac-local", status: "active" },
        { id: "ag-idle", role: "reviewer", host: "mac-remote", status: "active" },
      ],
    };

    const report = buildSchedulerLivePushReport({
      state: currState,
      previousState: prevState,
      runRoot: "run-001",
      pulseId: "pulse-42",
      actor: "test-mind",
      host: "macbook-pro",
      nowMs: 1700000000000,
      zeroValueStreak: 0,
      budget: { pulsesToday: 3, pulsesPerDay: 50, wallClockMsToday: 120000 },
    });

    expect(report.pushedAt).toBe(new Date(1700000000000).toISOString());
    expect(report.snapshot.completedTasks).toBe(1);
    expect(report.snapshot.leasedTasks).toBe(1);
    expect(report.snapshot.readyTasks).toBe(1);
    expect(report.snapshot.failedTasks).toBe(1);
    expect(report.diff.newlyCompletedTaskIds).toEqual(["t1"]);
    expect(report.diff.newlyLeasedTaskIds).toEqual(["t2"]);
    expect(report.diff.newlyReadyTaskIds).toEqual(["t3"]);
    expect(report.diff.newlyFailedTaskIds).toEqual(["t4"]);
    expect(report.isStagnating).toBe(false);

    expect(report.markdown).toContain("Scheduler Live Progress Report (Pulse: pulse-42)");
    expect(report.markdown).toContain("- **Run**: `run-001`");
    expect(report.markdown).toContain("- **Actor**: `test-mind`");
    expect(report.markdown).toContain("- **Host**: `macbook-pro`");
    expect(report.markdown).toContain("### 📈 Progress Overview");
    expect(report.markdown).toContain("### 🔄 Progress Delta");
    expect(report.markdown).toContain("- **Newly Completed**: `t1`");
    expect(report.markdown).toContain("- **Newly Leased**: `t2`");
    expect(report.markdown).toContain("- **Newly Ready**: `t3`");
    expect(report.markdown).toContain("- **Newly Failed**: `t4`");
    expect(report.markdown).toContain("### 🤖 Active Agents");
    expect(report.markdown).toContain("**ag-worker** (`coder` on `mac-local`) -> Task `t2`");
    expect(report.markdown).toContain("**ag-idle** (`reviewer` on `mac-remote`) (unassigned)");
    expect(report.markdown).toContain("### ⏳ Quota & Budget Headroom");

    expect(report.eventLedgerEntry.kind).toBe("scheduler-live-push");
    expect(report.eventLedgerEntry.payload.pulse_id).toBe("pulse-42");
    expect(report.eventLedgerEntry.payload.actor).toBe("test-mind");
  });

  it("builds live push report with direct previousSnapshot and critical stagnation alert", () => {
    const state: Record<string, unknown> = {
      run_id: "run-stagnant",
      tasks: {
        t1: { status: "leased", lease: { agent_id: "ag-stuck" } },
      },
      agents: [{ id: "ag-stuck", role: "coder", host: "node-1" }],
    };

    const initialReport = buildSchedulerLivePushReport({
      state,
      runRoot: "run-stagnant",
      nowMs: 1700000000000,
    });

    const stagnantReport = buildSchedulerLivePushReport({
      state,
      previousSnapshot: initialReport.snapshot,
      runRoot: "run-stagnant",
      nowMs: 1700000000000,
      zeroValueStreak: 12,
      stagnationCriticalThreshold: 10,
    });

    expect(stagnantReport.isStagnating).toBe(true);
    expect(stagnantReport.stagnation.level).toBe("critical");
    expect(stagnantReport.markdown).toContain("🚨 Stagnation Alert [CRITICAL]");
    expect(stagnantReport.markdown).toContain("- **Observation**:");
    expect(stagnantReport.markdown).toContain("- **Remediation**:");
  });

  it("formats markdown with empty tasks, warning stagnation, and without pulse/actor/budget", () => {
    const emptyState: Record<string, unknown> = {
      tasks: {},
      agents: [],
    };

    const initial = buildSchedulerLivePushReport({ state: emptyState, runRoot: "empty-run" });
    const warningReport = buildSchedulerLivePushReport({
      state: emptyState,
      previousSnapshot: initial.snapshot,
      runRoot: "empty-run",
      zeroValueStreak: 6,
      stagnationWarningThreshold: 5,
      stagnationCriticalThreshold: 10,
    });

    expect(warningReport.snapshot.totalTasks).toBe(0);
    expect(warningReport.stagnation.level).toBe("warning");
    expect(warningReport.markdown).toContain("### ⚠️ Stagnation Alert [WARNING]");
    expect(warningReport.markdown).toContain("Wave Complete/1 Active");
  });
});
