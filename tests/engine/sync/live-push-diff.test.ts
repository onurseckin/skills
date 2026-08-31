import { describe, expect, it } from "bun:test";
import {
  evaluateProgressDiff,
  extractSchedulerSnapshot,
  type SchedulerProgressDiff,
  type SchedulerProgressSnapshot,
} from "../../../olt/scripts/src/engine/scheduler/reporting/index.ts";
import { createTestProgressSnapshot } from "./index.ts";

describe("Snapshot Extraction, Diff Evaluator & Counterfactuals", () => {
  describe("Snapshot Extraction & Diff Evaluator", () => {
    it("extracts comprehensive progress snapshot from state object", () => {
      const state = {
        run_id: "test-run-123",
        tasks: {
          "task-1": { status: "completed", dependencies: [] },
          "task-2": {
            status: "leased",
            dependencies: [],
            lease: { agent_id: "impl-1", role: "implementer" },
          },
          "task-3": { status: "ready", dependencies: [] },
          "task-4": { status: "failed", dependencies: [] },
        },
        agents: [
          {
            id: "impl-1",
            role: "implementer",
            status: "active",
            task_id: "task-2",
            host: "claude-code",
          },
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
      const prevSnapshot = createTestProgressSnapshot({
        totalTasks: 3,
        completedTasks: 0,
        leasedTasks: 1,
        readyTasks: 1,
        proposedTasks: 1,
        tasks: [
          { id: "task-1", status: "leased", dependencies: [], wave: 1, lane: 1, effort: 1, assignedAgent: "worker-1", role: "implementer", writeScope: [] },
          { id: "task-2", status: "ready", dependencies: [], wave: 1, lane: 2, effort: 1, assignedAgent: null, role: null, writeScope: [] },
          { id: "task-3", status: "proposed", dependencies: ["task-1"], wave: 2, lane: 1, effort: 1, assignedAgent: null, role: null, writeScope: [] },
        ],
        waves: [
          { wave: 1, totalTasks: 2, completedTasks: 0, leasedTasks: 1, readyTasks: 1, failedTasks: 0, status: "running", isActive: true, laneCount: 2, taskIds: ["task-1", "task-2"] },
          { wave: 2, totalTasks: 1, completedTasks: 0, leasedTasks: 0, readyTasks: 0, failedTasks: 0, status: "pending", isActive: false, laneCount: 1, taskIds: ["task-3"] },
        ],
      });

      const currSnapshot = createTestProgressSnapshot({
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
      });

      const diff: SchedulerProgressDiff = evaluateProgressDiff(currSnapshot, prevSnapshot, 0);

      expect(diff.hasPrevious).toBe(true);
      expect(diff.completedDelta).toBe(1);
      expect(diff.newlyCompletedTaskIds).toContain("task-1");
      expect(diff.newlyLeasedTaskIds).toContain("task-2");
      expect(diff.isZeroProgress).toBe(false);
      expect(diff.consecutiveZeroProgressTicks).toBe(0);
    });

    it("evaluates zero delta when no state transitions occur and increments streak", () => {
      const snapshot = createTestProgressSnapshot({
        totalTasks: 2,
        completedTasks: 0,
        leasedTasks: 1,
        readyTasks: 1,
        proposedTasks: 0,
        tasks: [
          { id: "task-1", status: "leased", dependencies: [], wave: 1, lane: 1, effort: 1, assignedAgent: "worker-1", role: "implementer", writeScope: [] },
          { id: "task-2", status: "ready", dependencies: [], wave: 1, lane: 2, effort: 1, assignedAgent: null, role: null, writeScope: [] },
        ],
      });

      const diff = evaluateProgressDiff(snapshot, snapshot, 2);

      expect(diff.completedDelta).toBe(0);
      expect(diff.isZeroProgress).toBe(true);
      expect(diff.consecutiveZeroProgressTicks).toBe(3);
    });
  });

  describe("Edge Cases, Negative Tests & Counterfactual Proofs", () => {
    it("handles completely empty state object gracefully without throwing", () => {
      const emptySnapshot = extractSchedulerSnapshot({});
      expect(emptySnapshot.totalTasks).toBe(0);
      expect(emptySnapshot.activeAgents.length).toBe(0);
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
      const snapshotA = createTestProgressSnapshot({
        runRoot: "counterfactual-run",
        totalTasks: 2,
        completedTasks: 0,
        leasedTasks: 1,
        readyTasks: 1,
        tasks: [
          { id: "task-1", status: "leased", dependencies: [], wave: 1, lane: 1, effort: 1, assignedAgent: "w1", role: "implementer", writeScope: [] },
          { id: "task-2", status: "ready", dependencies: [], wave: 1, lane: 2, effort: 1, assignedAgent: null, role: null, writeScope: [] },
        ],
      });

      const snapshotB = createTestProgressSnapshot({
        ...snapshotA,
        capturedAt: "2026-08-31T01:05:00.000Z",
        completedTasks: 1,
        leasedTasks: 0,
        tasks: [
          { id: "task-1", status: "completed", dependencies: [], wave: 1, lane: 1, effort: 1, assignedAgent: "w1", role: "implementer", writeScope: [] },
          { id: "task-2", status: "ready", dependencies: [], wave: 1, lane: 2, effort: 1, assignedAgent: null, role: null, writeScope: [] },
        ],
      });

      const diff = evaluateProgressDiff(snapshotB, snapshotA, 10);
      expect(diff.isZeroProgress).toBe(false);
      expect(diff.consecutiveZeroProgressTicks).toBe(0);
    });
  });
});
