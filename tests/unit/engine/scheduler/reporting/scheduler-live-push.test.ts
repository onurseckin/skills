import { describe, expect, it } from "bun:test";
import {
  generateAgentStatusBadge,
  generateAsciiDagBadges,
  generateQuotaBudgetBadge,
  generateSchedulerTelemetryBanner,
  generateStagnationBadge,
  generateTaskStateBadge,
  generateWaveLaneBadges,
  type AgentBadgeItem,
  type QuotaBudgetBadgeItem,
  type TaskBadgeItem,
  type WaveLaneBadgeItem,
} from "../../../../../olt/scripts/src/engine/scheduler/diagnostics/ascii-badges.ts";
import {
  buildSchedulerLivePushReport,
  detectStagnation,
  evaluateProgressDiff,
  extractSchedulerSnapshot,
  formatSchedulerLivePushMarkdown,
  type SchedulerLiveReportOptions,
  type SchedulerProgressDiff,
  type SchedulerProgressSnapshot,
  type StagnationWarning,
} from "../../../../../olt/scripts/src/engine/scheduler/reporting/index.ts";
import {
  formatMindPulseActiveBrief,
  formatPulseDirective,
} from "../../../../../olt/scripts/src/cli/commands/mind-pulse-formatter.ts";

describe("Scheduler Live Chat Push & Progress Reporting Engine", () => {
  describe("ASCII Telemetry Badge Generators", () => {
    it("generates task state badges with glyphs, wave/lane coordinates, and lease assignments", () => {
      const pendingTask: TaskBadgeItem = {
        id: "task-1",
        status: "ready",
        wave: 1,
        lane: 1,
      };
      const pendingBadge = generateTaskStateBadge(pendingTask);
      expect(pendingBadge).toContain("W1:L1");
      expect(pendingBadge).toContain("task-1");

      const leasedTask: TaskBadgeItem = {
        id: "task-2",
        status: "leased",
        wave: 1,
        lane: 2,
        assignedAgent: "impl-worker-1",
        role: "implementer",
      };
      const leasedBadge = generateTaskStateBadge(leasedTask);
      expect(leasedBadge).toContain("W1:L2");
      expect(leasedBadge).toContain("impl-worker-1 (implementer) @ task-2");

      const completedTask: TaskBadgeItem = {
        id: "task-3",
        status: "completed",
        wave: 2,
        lane: 1,
      };
      const completedBadge = generateTaskStateBadge(completedTask);
      expect(completedBadge).toContain("W2:L1");
      expect(completedBadge).toContain("task-3");
    });

    it("generates agent status badges for active and empty sets", () => {
      const emptyBadge = generateAgentStatusBadge([]);
      expect(emptyBadge).toBe("[🤖 Agents: 0 active]");

      const agents: AgentBadgeItem[] = [
        { id: "agent-1", role: "implementer", status: "active", task_id: "task-1" },
        { id: "agent-2", role: "validator", status: "active" },
        { id: "agent-3", role: "implementer", status: "idle" },
      ];
      const agentBadge = generateAgentStatusBadge(agents);
      expect(agentBadge).toContain("Agents (2)");
      expect(agentBadge).toContain("agent-1 (implementer @ task-1)");
      expect(agentBadge).toContain("agent-2 (validator)");
      expect(agentBadge).not.toContain("agent-3");
    });

    it("generates quota budget badges with pulses, wall-clock, and headroom telemetry", () => {
      const budget: QuotaBudgetBadgeItem = {
        pulsesToday: 14,
        pulsesPerDay: 50,
        remainingQuotaPercent: 72,
        wallClockMsToday: 180000,
        wallClockMsPerDay: 600000,
      };
      const badge = generateQuotaBudgetBadge(budget);
      expect(badge).toContain("14/50 pulses");
      expect(badge).toContain("72% headroom");
      expect(badge).toContain("3m/10m wall-clock");

      const unlimitedBudget: QuotaBudgetBadgeItem = {
        pulsesToday: 5,
        pulsesPerDay: null,
      };
      const unlimitedBadge = generateQuotaBudgetBadge(unlimitedBudget);
      expect(unlimitedBadge).toContain("5/∞ pulses");
    });

    it("generates wave and lane status badges with active execution markers", () => {
      const waveItems: WaveLaneBadgeItem[] = [
        { wave: 1, lane_count: 3, status: "completed", is_active: false },
        { wave: 2, lane_count: 2, status: "running", is_active: true },
        { wave: 3, lane_count: 4, status: "pending", is_active: false },
      ];
      const badges = generateWaveLaneBadges(waveItems);
      expect(badges.length).toBe(3);
      expect(badges[0]).toBe("[Wave 1: 3 lane(s) (completed)]");
      expect(badges[1]).toBe("[Wave 2: 2 lane(s) (running) ⚡]");
      expect(badges[2]).toBe("[Wave 3: 4 lane(s) (pending)]");
    });

    it("generates stagnation badges according to zero-value streak thresholds", () => {
      expect(generateStagnationBadge(0)).toBe("[✨ Flowing: active progress]");
      expect(generateStagnationBadge(1)).toBe("[⚠️ Idling: streak 1]");
      expect(generateStagnationBadge(2)).toBe("[⚠️ Idling: streak 2]");
      expect(generateStagnationBadge(3)).toBe("[🚨 Stagnation Warning: streak 3]");
      expect(generateStagnationBadge(1, true)).toBe("[🚨 Stagnation Warning: streak 1]");
    });

    it("assembles complete scheduler telemetry banner", () => {
      const banner = generateSchedulerTelemetryBanner({
        stagnationBadge: "[✨ Flowing: active progress]",
        quotaBadge: "[⏳ Quota: 10/50 pulses]",
        agentBadge: "[🤖 Agents (1): impl-1 (implementer)]",
        waveBadge: "[Wave 1: 2 lane(s) (running) ⚡]",
        dagBadges: ["[W1:L1 ⏳ task-1]", "[W1:L2 ⚡ task-2]"],
      });

      expect(banner).toContain("[✨ Flowing: active progress]");
      expect(banner).toContain("[⏳ Quota: 10/50 pulses]");
      expect(banner).toContain("[🤖 Agents (1): impl-1 (implementer)]");
      expect(banner).toContain("[Wave 1: 2 lane(s) (running) ⚡]");
      expect(banner).toContain("[W1:L1 ⏳ task-1] [W1:L2 ⚡ task-2]");
    });

    it("computes DAG badges automatically from arbitrary state graph", () => {
      const state = {
        tasks: {
          "task-1": { status: "completed", dependencies: [] },
          "task-2": { status: "ready", dependencies: ["task-1"] },
          "task-3": { status: "leased", dependencies: ["task-1"], lease: { agent_id: "worker-1", role: "implementer" } },
          "task-4": { status: "proposed", dependencies: ["task-2", "task-3"] },
        },
      };

      const badges = generateAsciiDagBadges(state);
      expect(badges.length).toBe(4);
      expect(badges[0]).toContain("task-1");
      expect(badges[1]).toContain("task-2");
      expect(badges[2]).toContain("worker-1");
      expect(badges[3]).toContain("task-4");
    });
  });

  describe("Snapshot Extraction & Diff Evaluator", () => {
    it("extracts comprehensive progress snapshot from state object", () => {
      const state = {
        run_id: "test-run-123",
        tasks: {
          "task-1": { status: "completed", dependencies: [] },
          "task-2": { status: "leased", dependencies: [], lease: { agent_id: "impl-1", role: "implementer" } },
          "task-3": { status: "ready", dependencies: [] },
          "task-4": { status: "failed", dependencies: [] },
        },
        agents: [
          { id: "impl-1", role: "implementer", status: "active", task_id: "task-2", host: "claude-code" },
        ],
      };

      const snapshot: SchedulerProgressSnapshot = extractSchedulerSnapshot(state, {
        runRoot: "test-run-123",
        nowMs: 1700000000000,
      });

      expect(snapshot.runRoot).toBe("test-run-123");
      expect(snapshot.totalTasks).toBe(4);
      expect(snapshot.completedTasks).toBe(1);
      expect(snapshot.leasedTasks).toBe(1);
      expect(snapshot.readyTasks).toBe(1);
      expect(snapshot.failedTasks).toBe(1);
      expect(snapshot.activeAgents.length).toBe(1);
      expect(snapshot.waves.length).toBeGreaterThan(0);
    });

    it("evaluates progress diff between consecutive snapshots with state transitions", () => {
      const prevSnapshot: SchedulerProgressSnapshot = {
        capturedAt: "2026-08-31T01:00:00.000Z",
        runRoot: "test-run",
        totalTasks: 3,
        completedTasks: 0,
        leasedTasks: 1,
        readyTasks: 1,
        proposedTasks: 1,
        failedTasks: 0,
        tasks: [
          { id: "task-1", status: "leased", dependencies: [], wave: 1, lane: 1, effort: 1, assignedAgent: "worker-1", role: "implementer", writeScope: [] },
          { id: "task-2", status: "ready", dependencies: [], wave: 1, lane: 2, effort: 1, assignedAgent: null, role: null, writeScope: [] },
          { id: "task-3", status: "proposed", dependencies: ["task-1"], wave: 2, lane: 1, effort: 1, assignedAgent: null, role: null, writeScope: [] },
        ],
        waves: [
          { wave: 1, totalTasks: 2, completedTasks: 0, leasedTasks: 1, readyTasks: 1, failedTasks: 0, status: "running", isActive: true, laneCount: 2, taskIds: ["task-1", "task-2"] },
          { wave: 2, totalTasks: 1, completedTasks: 0, leasedTasks: 0, readyTasks: 0, failedTasks: 0, status: "pending", isActive: false, laneCount: 1, taskIds: ["task-3"] },
        ],
        activeAgents: [{ id: "worker-1", role: "implementer", task_id: "task-1", host: "claude-code" }],
        activeWave: 1,
        totalWaves: 2,
        quotaUsedToday: 1,
        quotaLimitToday: 50,
        wallClockMsToday: 1000,
      };

      const currSnapshot: SchedulerProgressSnapshot = {
        ...prevSnapshot,
        capturedAt: "2026-08-31T01:05:00.000Z",
        completedTasks: 1,
        leasedTasks: 1,
        readyTasks: 0,
        proposedTasks: 1,
        tasks: [
          { id: "task-1", status: "completed", dependencies: [], wave: 1, lane: 1, effort: 1, assignedAgent: "worker-1", role: "implementer", writeScope: [] },
          { id: "task-2", status: "leased", dependencies: [], wave: 1, lane: 2, effort: 1, assignedAgent: "worker-2", role: "implementer", writeScope: [] },
          { id: "task-3", status: "proposed", dependencies: ["task-1"], wave: 2, lane: 1, effort: 1, assignedAgent: null, role: null, writeScope: [] },
        ],
        activeAgents: [
          { id: "worker-2", role: "implementer", task_id: "task-2", host: "claude-code" },
        ],
      };

      const diff: SchedulerProgressDiff = evaluateProgressDiff(currSnapshot, prevSnapshot, 0);

      expect(diff.hasPrevious).toBe(true);
      expect(diff.completedDelta).toBe(1);
      expect(diff.newlyCompletedTaskIds).toContain("task-1");
      expect(diff.newlyLeasedTaskIds).toContain("task-2");
      expect(diff.isZeroProgress).toBe(false);
      expect(diff.consecutiveZeroProgressTicks).toBe(0);
    });

    it("evaluates zero delta when no state transitions occur and increments streak", () => {
      const snapshot: SchedulerProgressSnapshot = {
        capturedAt: "2026-08-31T01:00:00.000Z",
        runRoot: "test-run",
        totalTasks: 2,
        completedTasks: 0,
        leasedTasks: 1,
        readyTasks: 1,
        proposedTasks: 0,
        failedTasks: 0,
        tasks: [
          { id: "task-1", status: "leased", dependencies: [], wave: 1, lane: 1, effort: 1, assignedAgent: "worker-1", role: "implementer", writeScope: [] },
          { id: "task-2", status: "ready", dependencies: [], wave: 1, lane: 2, effort: 1, assignedAgent: null, role: null, writeScope: [] },
        ],
        waves: [
          { wave: 1, totalTasks: 2, completedTasks: 0, leasedTasks: 1, readyTasks: 1, failedTasks: 0, status: "running", isActive: true, laneCount: 2, taskIds: ["task-1", "task-2"] },
        ],
        activeAgents: [{ id: "worker-1", role: "implementer", task_id: "task-1", host: "claude-code" }],
        activeWave: 1,
        totalWaves: 1,
        quotaUsedToday: 2,
        quotaLimitToday: 50,
        wallClockMsToday: 2000,
      };

      const diff = evaluateProgressDiff(snapshot, snapshot, 2);

      expect(diff.completedDelta).toBe(0);
      expect(diff.isZeroProgress).toBe(true);
      expect(diff.consecutiveZeroProgressTicks).toBe(3);
    });
  });

  describe("Stagnation Detection & Warnings", () => {
    it("detects complete status when all DAG tasks are completed", () => {
      const snapshot: SchedulerProgressSnapshot = {
        capturedAt: "2026-08-31T01:00:00.000Z",
        runRoot: "test-run",
        totalTasks: 3,
        completedTasks: 3,
        leasedTasks: 0,
        readyTasks: 0,
        proposedTasks: 0,
        failedTasks: 0,
        tasks: [],
        waves: [],
        activeAgents: [],
        activeWave: null,
        totalWaves: 1,
        quotaUsedToday: 3,
        quotaLimitToday: 50,
        wallClockMsToday: 3000,
      };

      const diff = evaluateProgressDiff(snapshot, snapshot, 0);
      const warning: StagnationWarning = detectStagnation({ diff, snapshot });

      expect(warning.level).toBe("none");
      expect(warning.isStagnating).toBe(false);
      expect(warning.reason).toContain("completed successfully");
    });

    it("detects worker starvation when tasks are ready but zero agents are dispatched", () => {
      const snapshot: SchedulerProgressSnapshot = {
        capturedAt: "2026-08-31T01:00:00.000Z",
        runRoot: "test-run",
        totalTasks: 3,
        completedTasks: 1,
        leasedTasks: 0,
        readyTasks: 2,
        proposedTasks: 0,
        failedTasks: 0,
        tasks: [
          { id: "task-1", status: "completed", dependencies: [], wave: 1, lane: 1, effort: 1, assignedAgent: null, role: null, writeScope: [] },
          { id: "task-2", status: "ready", dependencies: [], wave: 1, lane: 2, effort: 1, assignedAgent: null, role: null, writeScope: [] },
          { id: "task-3", status: "ready", dependencies: [], wave: 1, lane: 3, effort: 1, assignedAgent: null, role: null, writeScope: [] },
        ],
        waves: [],
        activeAgents: [],
        activeWave: 1,
        totalWaves: 1,
        quotaUsedToday: 1,
        quotaLimitToday: 50,
        wallClockMsToday: 1000,
      };

      const diff = evaluateProgressDiff(snapshot, null, 0);
      const warning = detectStagnation({ diff, snapshot });

      expect(warning.isStagnating).toBe(true);
      expect(warning.reason).toContain("waiting in queue but 0 active agents");
      expect(warning.badge).toContain("Worker Starvation");
    });

    it("detects critical failure stagnation when failed tasks exist without active repairs", () => {
      const snapshot: SchedulerProgressSnapshot = {
        capturedAt: "2026-08-31T01:00:00.000Z",
        runRoot: "test-run",
        totalTasks: 2,
        completedTasks: 0,
        leasedTasks: 0,
        readyTasks: 0,
        proposedTasks: 0,
        failedTasks: 1,
        tasks: [
          { id: "task-1", status: "failed", dependencies: [], wave: 1, lane: 1, effort: 1, assignedAgent: null, role: null, writeScope: [] },
        ],
        waves: [],
        activeAgents: [],
        activeWave: 1,
        totalWaves: 1,
        quotaUsedToday: 1,
        quotaLimitToday: 50,
        wallClockMsToday: 1000,
      };

      const diff = evaluateProgressDiff(snapshot, null, 0);
      const warning = detectStagnation({ diff, snapshot });

      expect(warning.level).toBe("critical");
      expect(warning.isStagnating).toBe(true);
      expect(warning.reason).toContain("failed and no repairers");
      expect(warning.badge).toContain("Failed Tasks");
    });

    it("detects critical stagnation when zero-progress streak exceeds critical threshold", () => {
      const snapshot: SchedulerProgressSnapshot = {
        capturedAt: "2026-08-31T01:00:00.000Z",
        runRoot: "test-run",
        totalTasks: 4,
        completedTasks: 1,
        leasedTasks: 1,
        readyTasks: 1,
        proposedTasks: 1,
        failedTasks: 0,
        tasks: [],
        waves: [],
        activeAgents: [{ id: "worker-1", role: "implementer", host: "claude-code" }],
        activeWave: 1,
        totalWaves: 2,
        quotaUsedToday: 2,
        quotaLimitToday: 50,
        wallClockMsToday: 2000,
      };

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
          "task-2": { status: "leased", dependencies: [], lease: { agent_id: "worker-alpha", role: "implementer" } },
          "task-3": { status: "ready", dependencies: ["task-1"] },
        },
        agents: [
          { id: "worker-alpha", role: "implementer", status: "active", task_id: "task-2", host: "claude-code" },
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

  describe("Edge Cases, Negative Tests & Counterfactual Proofs", () => {
    it("handles completely empty state object gracefully without throwing", () => {
      const emptySnapshot = extractSchedulerSnapshot({});
      expect(emptySnapshot.totalTasks).toBe(0);
      expect(emptySnapshot.activeAgents.length).toBe(0);

      const badges = generateAsciiDagBadges({});
      expect(badges.length).toBe(0);
    });

    it("handles malformed task entries and non-record elements gracefully", () => {
      const malformedState = {
        tasks: {
          "invalid-task-1": null,
          "invalid-task-2": "not an object",
          "valid-task": { status: "ready" },
        },
      };

      const snapshot = extractSchedulerSnapshot(malformedState);
      expect(snapshot.totalTasks).toBe(1);
      expect(snapshot.readyTasks).toBe(1);
    });

    it("counterfactual proof: positive progress delta resets zeroValueStreak in diff", () => {
      const snapshotA: SchedulerProgressSnapshot = {
        capturedAt: "2026-08-31T01:00:00.000Z",
        runRoot: "counterfactual-run",
        totalTasks: 2,
        completedTasks: 0,
        leasedTasks: 1,
        readyTasks: 1,
        proposedTasks: 0,
        failedTasks: 0,
        tasks: [
          { id: "task-1", status: "leased", dependencies: [], wave: 1, lane: 1, effort: 1, assignedAgent: "w1", role: "implementer", writeScope: [] },
          { id: "task-2", status: "ready", dependencies: [], wave: 1, lane: 2, effort: 1, assignedAgent: null, role: null, writeScope: [] },
        ],
        waves: [],
        activeAgents: [{ id: "w1", role: "implementer", host: "claude-code" }],
        activeWave: 1,
        totalWaves: 1,
        quotaUsedToday: 1,
        quotaLimitToday: 50,
        wallClockMsToday: 1000,
      };

      const snapshotB: SchedulerProgressSnapshot = {
        ...snapshotA,
        capturedAt: "2026-08-31T01:05:00.000Z",
        completedTasks: 1,
        leasedTasks: 0,
        tasks: [
          { id: "task-1", status: "completed", dependencies: [], wave: 1, lane: 1, effort: 1, assignedAgent: "w1", role: "implementer", writeScope: [] },
          { id: "task-2", status: "ready", dependencies: [], wave: 1, lane: 2, effort: 1, assignedAgent: null, role: null, writeScope: [] },
        ],
      };

      // Even with an accumulated prior streak of 10, a positive progress transition resets streak to 0
      const diff = evaluateProgressDiff(snapshotB, snapshotA, 10);
      expect(diff.isZeroProgress).toBe(false);
      expect(diff.consecutiveZeroProgressTicks).toBe(0);

      const warning = detectStagnation({ diff, snapshot: snapshotB, zeroValueStreak: 0 });
      expect(warning.isStagnating).toBe(false);
      expect(warning.level).toBe("none");
    });
  });
});
