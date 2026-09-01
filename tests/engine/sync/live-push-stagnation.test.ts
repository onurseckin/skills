import { describe, expect, it } from "bun:test";
import {
  buildSchedulerLivePushReport,
  detectStagnation,
  evaluateProgressDiff,
  type SchedulerLiveReportOptions,
  type StagnationWarning,
} from "../../../olt/scripts/src/engine/scheduler/reporting/index.ts";
import {
  formatMindPulseActiveBrief,
  formatPulseDirective,
} from "../../../olt/scripts/src/cli/commands/mind-pulse-formatter.ts";
import { createTestProgressSnapshot } from "./index.ts";

describe("Stagnation Detection, Live Push Reports & Mind Pulse", () => {
  describe("Stagnation Detection & Warnings", () => {
    it("detects complete status when all DAG tasks are completed", () => {
      const snapshot = createTestProgressSnapshot({
        totalTasks: 3,
        completedTasks: 3,
        leasedTasks: 0,
        readyTasks: 0,
        activeWave: null,
      });

      const diff = evaluateProgressDiff(snapshot, snapshot, 0);
      const warning: StagnationWarning = detectStagnation({ diff, snapshot });

      expect(warning.level).toBe("none");
      expect(warning.isStagnating).toBe(false);
      expect(warning.reason).toContain("completed successfully");
    });

    it("detects worker starvation when tasks are ready but zero agents are dispatched", () => {
      const snapshot = createTestProgressSnapshot({
        totalTasks: 3,
        completedTasks: 1,
        leasedTasks: 0,
        readyTasks: 2,
        tasks: [
          {
            id: "task-1",
            status: "completed",
            dependencies: [],
            wave: 1,
            lane: 1,
            effort: 1,
            assignedAgent: null,
            role: null,
            writeScope: [],
          },
          {
            id: "task-2",
            status: "ready",
            dependencies: [],
            wave: 1,
            lane: 2,
            effort: 1,
            assignedAgent: null,
            role: null,
            writeScope: [],
          },
          {
            id: "task-3",
            status: "ready",
            dependencies: [],
            wave: 1,
            lane: 3,
            effort: 1,
            assignedAgent: null,
            role: null,
            writeScope: [],
          },
        ],
        activeAgents: [],
      });

      const diff = evaluateProgressDiff(snapshot, null, 0);
      const warning = detectStagnation({ diff, snapshot });

      expect(warning.isStagnating).toBe(true);
      expect(warning.reason).toContain("waiting in queue but 0 active agents");
      expect(warning.badge).toContain("Worker Starvation");
    });

    it("detects critical failure stagnation when failed tasks exist without active repairs", () => {
      const snapshot = createTestProgressSnapshot({
        totalTasks: 2,
        completedTasks: 0,
        leasedTasks: 0,
        readyTasks: 0,
        failedTasks: 1,
        tasks: [
          {
            id: "task-1",
            status: "failed",
            dependencies: [],
            wave: 1,
            lane: 1,
            effort: 1,
            assignedAgent: null,
            role: null,
            writeScope: [],
          },
        ],
        activeAgents: [],
      });

      const diff = evaluateProgressDiff(snapshot, null, 0);
      const warning = detectStagnation({ diff, snapshot });

      expect(warning.level).toBe("critical");
      expect(warning.isStagnating).toBe(true);
      expect(warning.reason).toContain("failed and no repairers");
      expect(warning.badge).toContain("Failed Tasks");
    });

    it("detects critical stagnation when zero-progress streak exceeds critical threshold", () => {
      const snapshot = createTestProgressSnapshot({
        totalTasks: 4,
        completedTasks: 1,
        leasedTasks: 1,
        readyTasks: 1,
        totalWaves: 2,
      });

      const diff = evaluateProgressDiff(snapshot, snapshot, 5);
      const warning = detectStagnation({ diff, snapshot, criticalThreshold: 4 });

      expect(warning.level).toBe("critical");
      expect(warning.isStagnating).toBe(true);
      expect(warning.streak).toBeGreaterThanOrEqual(4);
    });
  });

  describe("Live Push Report Emitter & Markdown Formatter", () => {
    it("builds end-to-end scheduler live push report with full markdown emission", () => {
      const state = {
        run_id: "live-report-run",
        tasks: {
          "task-1": { status: "completed", dependencies: [] },
          "task-2": {
            status: "leased",
            dependencies: [],
            lease: { agent_id: "worker-alpha", role: "implementer" },
          },
          "task-3": { status: "ready", dependencies: ["task-1"] },
        },
        agents: [
          {
            id: "worker-alpha",
            role: "implementer",
            status: "active",
            task_id: "task-2",
            host: "claude-code",
          },
        ],
      };

      const options: SchedulerLiveReportOptions = {
        runRoot: "live-report-run",
        state,
        nowMs: 1700000000000,
        actor: "mind-scheduler",
        host: "claude-code",
        driver: "claude",
        pulseId: "pulse-101",
        budget: {
          pulsesToday: 10,
          pulsesPerDay: 40,
          remainingQuotaPercent: 75,
        },
        zeroValueStreak: 0,
      };

      const report = buildSchedulerLivePushReport(options);

      expect(report.snapshot.runRoot).toBe("live-report-run");
      expect(report.snapshot.totalTasks).toBe(3);
      expect(report.snapshot.completedTasks).toBe(1);
      expect(report.snapshot.leasedTasks).toBe(1);
      expect(report.asciiBadges.telemetryBanner).toContain("Flowing");
      expect(report.asciiBadges.telemetryBanner).toContain("Quota");
      expect(report.asciiBadges.dagBadges.length).toBe(3);

      expect(report.markdown).toContain("Scheduler Live Progress Report");
      expect(report.markdown).toContain("live-report-run");
      expect(report.markdown).toContain("Progress Overview");

      expect(report.eventLedgerEntry.kind).toBe("scheduler-live-push");
      expect(report.eventLedgerEntry.payload.pulse_id).toBe("pulse-101");
    });

    it("formats markdown with stagnation warnings when streak is active", () => {
      const state = {
        run_id: "stagnation-run",
        tasks: {
          "task-1": { status: "ready", dependencies: [] },
        },
        agents: [],
      };

      const options: SchedulerLiveReportOptions = {
        runRoot: "stagnation-run",
        state,
        actor: "mind",
        host: "antigravity",
        driver: "gemini",
        pulseId: "pulse-stagnant",
        zeroValueStreak: 4,
      };

      const report = buildSchedulerLivePushReport(options);

      expect(report.stagnation.isStagnating).toBe(true);
      expect(report.markdown).toContain("Stagnation Alert");
      expect(report.markdown).toContain("Remediation");
    });
  });

  describe("Mind Pulse Formatter Integration", () => {
    it("formats pulse directives for stagnation and Mode A activation", () => {
      const stagnationDirective = formatPulseDirective({
        activeRuns: 1,
        pendingBacklog: 0,
        isStagnating: true,
        stagnationStreak: 3,
        stagnationReason: "0 tasks transitioning",
        stagnationRemediation: "Dispatch workers",
      });
      expect(stagnationDirective).toContain("STAGNATION MITIGATION DIRECTIVE");
      expect(stagnationDirective).toContain("Dispatch workers");

      const modeADirective = formatPulseDirective({
        activeRuns: 0,
        pendingBacklog: 0,
      });
      expect(modeADirective).toContain("MODE A AUTONOMOUS DISCOVERY REQUIRED");

      const readyDirective = formatPulseDirective({
        activeRuns: 0,
        pendingBacklog: 2,
        readyTasksCount: 3,
      });
      expect(readyDirective).toContain("READY TASK DISPATCH REQUIRED");
    });

    it("formats complete mind pulse active brief with badges and banner", () => {
      const brief = formatMindPulseActiveBrief({
        pulseId: "pulse-55",
        runRoot: "capsule-55",
        actor: "mind-agent",
        host: "claude-code",
        driver: "claude",
        openedAt: "2026-08-31T01:00:00.000Z",
        deadlineAt: "2026-08-31T01:10:00.000Z",
        scheduledIntervalMs: 600000,
        nextWakeAt: "2026-08-31T01:10:00.000Z",
        pulsesToday: 5,
        pulsesPerDay: 50,
        telemetryBanner: "[✨ Flowing: active progress] | [⏳ Quota: 5/50 pulses]",
        dagBadges: ["[W1:L1 ⏳ task-1]"],
      });

      expect(brief).toContain("pulse-55");
      expect(brief).toContain("mind-agent");
      expect(brief).toContain("Flowing");
      expect(brief).toContain("task-1");
    });
  });
});
