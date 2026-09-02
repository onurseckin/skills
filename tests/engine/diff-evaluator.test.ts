import { describe, expect, it } from "bun:test";
import {
  evaluateProgressDiff,
  extractSchedulerSnapshot,
} from "../../olt/scripts/src/engine/scheduler/reporting/diff-evaluator.ts";
import type { SchedulerProgressSnapshot } from "../../olt/scripts/src/engine/scheduler/reporting/types.ts";

describe("diff-evaluator coverage suite", () => {
  it("extracts snapshot with full compiled tasks, leases, agents, cycles, and budget", () => {
    const state: Record<string, unknown> = {
      run_id: "run-xyz",
      tasks: {
        t1: { status: "completed", deps: [], effort: 2, write_scope: ["a.ts"] },
        t2: {
          status: "leased",
          dependencies: ["t1"],
          lease: { agent_id: " ag-1 ", role: "coder" },
        },
        t3: {
          status: "running",
          dependencies: ["t2"],
          lease: { agent: " ag-2 ", role: "tester" },
        },
        t4: { status: "validating", deps: ["t3"], assignedAgent: "ag-3" },
        t5: { status: "done", deps: ["t4"] },
        t6: { status: "passed", deps: ["t5"] },
        t7: { status: "verified", deps: ["t6"] },
        t8: { status: "submitted", deps: ["t7"] },
        t9: { status: "failed", deps: ["t8"] },
        t10: { status: "rejected", deps: ["t9"] },
        t11: { status: "stale", deps: ["t10"] },
        t12: { status: "dead", deps: ["t11"] },
        t13: { status: "ready", deps: ["t12"] },
        t14: { status: "proposed", deps: ["t13"] },
        t15: { deps: ["t16"] },
        t16: { deps: ["t15"] },
        invalid: "skip-non-record",
      },
      agents: [
        { id: "ag-1", role: "coder", host: "node-1", status: "active" },
        { id: "ag-2", role: "tester", host: "node-2" },
        { id: "ag-orphan", parent_task_id: "t14", host: "node-3" },
        { id: "ag-inactive", status: "stopped" },
        "skip-invalid-agent",
      ],
    };

    const snap = extractSchedulerSnapshot(state, {
      runRoot: "override-root",
      nowMs: 1700000000000,
      budget: { pulsesToday: 5, pulsesPerDay: 20, wallClockMsToday: 1000 },
    });

    expect(snap.runRoot).toBe("override-root");
    expect(snap.quotaUsedToday).toBe(5);
    expect(snap.quotaLimitToday).toBe(20);
    expect(snap.wallClockMsToday).toBe(1000);
    expect(snap.completedTasks).toBe(5);
    expect(snap.leasedTasks).toBe(3);
    expect(snap.failedTasks).toBe(4);
    expect(snap.readyTasks).toBe(1);
    expect(snap.proposedTasks).toBe(3);
    expect(snap.activeAgents.length).toBe(3);
    expect(snap.activeWave).toBe(2);
  });

  it("extracts snapshot from planning_buffer fallback and default fallbacks", () => {
    const state: Record<string, unknown> = {
      planning_buffer: [
        { id: "p1", deps: [], effort: 3, write_scope: ["src/x.ts"] },
        { id: "p2", deps: ["p1"], writeScope: ["src/y.ts"] },
        { effort: "invalid-effort" },
        null,
      ],
    };

    const snap = extractSchedulerSnapshot(state);
    expect(snap.runRoot).toBe("unknown");
    expect(snap.totalTasks).toBe(3);
    expect(snap.proposedTasks).toBe(3);
    expect(snap.tasks[0]?.writeScope).toEqual(["src/x.ts"]);
    expect(snap.tasks[1]?.writeScope).toEqual(["src/y.ts"]);
    expect(snap.quotaLimitToday).toBeNull();
  });

  it("evaluates progress diff without previous snapshot", () => {
    const snap = extractSchedulerSnapshot({ run_id: "init-run" });
    const diff = evaluateProgressDiff(snap, null, 0);
    expect(diff.hasPrevious).toBe(false);
    expect(diff.isZeroProgress).toBe(false);
    expect(diff.consecutiveZeroProgressTicks).toBe(0);
    expect(diff.summary).toContain("Initial snapshot");
  });

  it("evaluates comprehensive diff transitions across all status buckets, wave, and agents", () => {
    const baseState: Record<string, unknown> = {
      run_id: "run-diff",
      tasks: {
        t1: { status: "ready" },
        t2: { status: "proposed" },
        t3: { status: "leased" },
        t8: { status: "ready" },
      },
      agents: [{ id: "ag-1" }, { id: "ag-2" }],
    };
    const prevSnap = extractSchedulerSnapshot(baseState);

    const nextState: Record<string, unknown> = {
      run_id: "run-diff",
      tasks: {
        t1: { status: "completed" },
        t2: { status: "ready" },
        t3: { status: "failed" },
        t4: { status: "leased" },
        t5: { status: "completed" },
        t6: { status: "ready" },
        t7: { status: "failed" },
        t8: { status: "leased" },
      },
      agents: [{ id: "ag-1" }],
    };
    const currSnap = extractSchedulerSnapshot(nextState);

    const diff = evaluateProgressDiff(currSnap, prevSnap, 0);
    expect(diff.hasPrevious).toBe(true);
    expect(diff.newlyCompletedTaskIds).toEqual(["t1", "t5"]);
    expect(diff.newlyReadyTaskIds).toEqual(["t2", "t6"]);
    expect(diff.newlyFailedTaskIds).toEqual(["t3", "t7"]);
    expect(diff.newlyLeasedTaskIds).toEqual(["t4", "t8"]);
    expect(diff.agentDelta).toBe(-1);
    expect(diff.isZeroProgress).toBe(false);
    expect(diff.summary).toContain("+2 completed (t1, t5)");
    expect(diff.summary).toContain("+2 leased (t4, t8)");
    expect(diff.summary).toContain("+2 ready (t2, t6)");
    expect(diff.summary).toContain("!2 failed (t3, t7)");
    expect(diff.summary).toContain("-1 agents");
  });

  it("handles zero progress streak accumulation, wave advance, and positive agent delta", () => {
    const snap1: SchedulerProgressSnapshot = {
      capturedAt: "2026-09-01T00:00:00.000Z",
      runRoot: "r1",
      totalTasks: 1,
      completedTasks: 0,
      leasedTasks: 1,
      readyTasks: 0,
      proposedTasks: 0,
      failedTasks: 0,
      tasks: [
        {
          id: "t1",
          status: "leased",
          effort: 1,
          dependencies: [],
          assignedAgent: "a1",
          role: null,
          wave: 1,
          lane: 1,
          writeScope: [],
        },
      ],
      activeAgents: [{ id: "a1", role: "r", host: "h", status: "active", task_id: "t1" }],
      waves: [],
      activeWave: 1,
      totalWaves: 2,
      quotaUsedToday: 0,
      quotaLimitToday: null,
      wallClockMsToday: 0,
    };

    const snap2: SchedulerProgressSnapshot = {
      ...snap1,
      activeWave: 2,
      activeAgents: [
        ...snap1.activeAgents,
        { id: "a2", role: "r", host: "h", status: "active", task_id: null },
      ],
    };

    const diffZero = evaluateProgressDiff(snap1, snap1, 3);
    expect(diffZero.isZeroProgress).toBe(true);
    expect(diffZero.consecutiveZeroProgressTicks).toBe(4);
    expect(diffZero.summary).toBe("No task transitions (streak: 4)");

    const diffWaveAndAgent = evaluateProgressDiff(snap2, snap1, 0);
    expect(diffWaveAndAgent.activeWaveChanged).toBe(true);
    expect(diffWaveAndAgent.agentDelta).toBe(1);
    expect(diffWaveAndAgent.summary).toContain("Wave advanced: W1 -> W2");
    expect(diffWaveAndAgent.summary).toContain("+1 agents");
  });
});
