import { describe, expect, it } from "bun:test";
import {
  calculateHierarchyCapacity,
  evaluateHierarchyScaling,
} from "../../../../olt/scripts/src/mind/lifecycle/evolution/cadence.ts";
import {
  DEFAULT_SCALING_THRESHOLDS,
  type HierarchyCapacityMetrics,
  type OrchestratorNodeInfo,
} from "../../../../olt/scripts/src/mind/lifecycle/evolution/types.ts";
import type { TaskQueueItem } from "../../../../olt/scripts/src/task/queue/index.ts";

describe("Evolution Cadence Suite (cadence.ts)", () => {
  const makeTask = (id: string, status: TaskQueueItem["status"]): TaskQueueItem =>
    ({
      id,
      title: `Task ${id}`,
      description: "Desc",
      category: "mind-cycle",
      priority: "NORMAL",
      status,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }) as TaskQueueItem;

  const makeOrch = (
    id: string,
    tier: 1 | 2,
    load: number,
    status: OrchestratorNodeInfo["status"] = "ACTIVE",
  ): OrchestratorNodeInfo => ({
    id,
    role: tier === 1 ? "orchestrator" : "coordinator",
    tier,
    domainSlug: `domain-${id}`,
    assignedTaskIds: Array.from({ length: load }, (_, i) => `t-${i}`),
    assignedWriteScopes: ["src/"],
    capacity: 10,
    currentLoad: load,
    status,
  });

  describe("calculateHierarchyCapacity", () => {
    it("handles empty parameters with default baseline values", () => {
      const metrics = calculateHierarchyCapacity({});
      expect(metrics.activeTier1Count).toBe(1);
      expect(metrics.activeTier2Count).toBe(1);
      expect(metrics.activeTier3Workers).toBe(0);
      expect(metrics.totalPendingTasks).toBe(0);
      expect(metrics.totalInProgressTasks).toBe(0);
      expect(metrics.tier1LoadRatio).toBe(0);
      expect(metrics.tier2LoadRatio).toBe(0);
      expect(metrics.tier3Utilization).toBe(0);
      expect(metrics.scalingDirection).toBe("STEADY");
      expect(metrics.reasons[0]).toContain("Hierarchy capacity steady");
    });

    it("accurately counts pending, admitted, in-progress, and running tasks", () => {
      const tasks: TaskQueueItem[] = [
        makeTask("t1", "PENDING"),
        makeTask("t2", "ADMITTED"),
        makeTask("t3", "IN_PROGRESS"),
        makeTask("t4", "RUNNING"),
        makeTask("t5", "COMPLETED"),
        makeTask("t6", "FAILED"),
      ];
      const metrics = calculateHierarchyCapacity({
        taskQueue: tasks,
        orchestrators: [makeOrch("o1", 1, 2), makeOrch("c1", 2, 2)],
        activeWorkersCount: 3,
        maxWorkersCapacity: 6,
      });
      expect(metrics.totalPendingTasks).toBe(2);
      expect(metrics.totalInProgressTasks).toBe(2);
      expect(metrics.activeTier3Workers).toBe(3);
      expect(metrics.tier3Utilization).toBe(0.5);
      expect(metrics.tier1LoadRatio).toBe(4);
      expect(metrics.tier2LoadRatio).toBe(4);
    });

    it("filters out DRAINING orchestrators from active tier counts", () => {
      const orchs = [
        makeOrch("o1", 1, 1, "ACTIVE"),
        makeOrch("o2", 1, 1, "DRAINING"),
        makeOrch("c1", 2, 1, "DRAINING"),
      ];
      const metrics = calculateHierarchyCapacity({ orchestrators: orchs });
      expect(metrics.activeTier1Count).toBe(1);
      expect(metrics.activeTier2Count).toBe(1); // clamped to min 1
    });

    it("triggers SCALE_OUT when tier 1 load ratio exceeds threshold", () => {
      const tasks = [
        makeTask("t1", "PENDING"),
        makeTask("t2", "PENDING"),
        makeTask("t3", "IN_PROGRESS"),
        makeTask("t4", "RUNNING"),
        makeTask("t5", "RUNNING"),
        makeTask("t6", "RUNNING"),
        makeTask("t7", "RUNNING"),
      ];
      const metrics = calculateHierarchyCapacity({
        taskQueue: tasks,
        orchestrators: [makeOrch("o1", 1, 1)],
      });
      expect(metrics.scalingDirection).toBe("SCALE_OUT");
      expect(metrics.recommendedTier1Count).toBeGreaterThan(1);
      expect(metrics.reasons[0]).toContain("exceeds scale-out threshold");
    });

    it("triggers SCALE_IN when queue is quiescent and active tier 1 exceeds minTier1Limit", () => {
      const orchs = [makeOrch("o1", 1, 0), makeOrch("o2", 1, 0), makeOrch("o3", 1, 0)];
      const metrics = calculateHierarchyCapacity({
        taskQueue: [],
        orchestrators: orchs,
      });
      expect(metrics.scalingDirection).toBe("SCALE_IN");
      expect(metrics.reasons[0]).toContain("Queue is quiescent with 3 active orchestrator(s)");
    });

    it("triggers SCALE_IN when load ratio is below scale-in threshold with excess orchestrators", () => {
      const tasks = [makeTask("t1", "PENDING")];
      const orchs = [
        makeOrch("o1", 1, 1),
        makeOrch("o2", 1, 0),
        makeOrch("o3", 1, 0),
        makeOrch("o4", 1, 0),
        makeOrch("o5", 1, 0),
      ];
      const metrics = calculateHierarchyCapacity({
        taskQueue: tasks,
        orchestrators: orchs,
      });
      expect(metrics.tier1LoadRatio).toBe(0.2); // 1 / 5 = 0.2 < 0.3
      expect(metrics.scalingDirection).toBe("SCALE_IN");
      expect(metrics.reasons[0]).toContain("below scale-in threshold");
    });

    it("triggers REBALANCE when load variance between orchestrators is >= 3", () => {
      const tasks = [makeTask("t1", "PENDING"), makeTask("t2", "PENDING")];
      const orchs = [makeOrch("o1", 1, 5), makeOrch("o2", 1, 1)];
      const metrics = calculateHierarchyCapacity({
        taskQueue: tasks,
        orchestrators: orchs,
      });
      expect(metrics.scalingDirection).toBe("REBALANCE");
      expect(metrics.reasons[0]).toContain("Load imbalance detected");
    });

    it("evaluates STEADY when multiple orchestrators have balanced load", () => {
      const tasks = [makeTask("t1", "PENDING")];
      const orchs = [makeOrch("o1", 1, 1), makeOrch("o2", 1, 2)];
      const metrics = calculateHierarchyCapacity({
        taskQueue: tasks,
        orchestrators: orchs,
        thresholds: { scaleInLoadThreshold: 0.1 },
      });
      expect(metrics.scalingDirection).toBe("STEADY");
      expect(metrics.reasons[0]).toContain("Hierarchy capacity steady");
    });

    it("respects custom scaling thresholds and limits", () => {
      const tasks = Array.from({ length: 40 }, (_, i) => makeTask(`t${i}`, "PENDING"));
      const metrics = calculateHierarchyCapacity({
        taskQueue: tasks,
        thresholds: {
          maxTier1Limit: 4,
          maxTier2Limit: 6,
          maxTasksPerTier1Orchestrator: 2,
        },
      });
      expect(metrics.recommendedTier1Count).toBe(4);
      expect(metrics.recommendedTier2Count).toBe(6);
    });
  });

  describe("evaluateHierarchyScaling", () => {
    it("generates spawn recommendations when scaling out", () => {
      const metrics: HierarchyCapacityMetrics = {
        activeTier1Count: 1,
        activeTier2Count: 1,
        activeTier3Workers: 2,
        totalPendingTasks: 15,
        totalInProgressTasks: 5,
        tier1LoadRatio: 20,
        tier2LoadRatio: 20,
        tier3Utilization: 1,
        recommendedTier1Count: 3,
        recommendedTier2Count: 4,
        scalingDirection: "SCALE_OUT",
        reasons: ["Tier 1 overloaded"],
      };

      const decision = evaluateHierarchyScaling(metrics);
      expect(decision.action).toBe("SCALE_OUT");
      expect(decision.newTier1Count).toBe(3);
      expect(decision.newTier2Count).toBe(4);
      expect(decision.spawnsRecommended.length).toBe(5); // (3-1) + (4-1) = 2 + 3 = 5
      expect(decision.spawnsRecommended.filter((s) => s.role === "orchestrator").length).toBe(2);
      expect(decision.spawnsRecommended.filter((s) => s.role === "coordinator").length).toBe(3);
      expect(decision.drainsRecommended).toEqual([]);
      expect(decision.reason).toBe("Tier 1 overloaded");
    });

    it("handles SCALE_OUT with only tier 2 needing spawns", () => {
      const metrics: HierarchyCapacityMetrics = {
        activeTier1Count: 3,
        activeTier2Count: 1,
        activeTier3Workers: 0,
        totalPendingTasks: 6,
        totalInProgressTasks: 0,
        tier1LoadRatio: 2,
        tier2LoadRatio: 6,
        tier3Utilization: 0,
        recommendedTier1Count: 3,
        recommendedTier2Count: 3,
        scalingDirection: "SCALE_OUT",
        reasons: ["Coordinators needed"],
      };

      const decision = evaluateHierarchyScaling(metrics);
      expect(decision.spawnsRecommended.length).toBe(2);
      expect(decision.spawnsRecommended.every((s) => s.role === "coordinator")).toBe(true);
    });

    it("handles SCALE_IN decision", () => {
      const metrics: HierarchyCapacityMetrics = {
        activeTier1Count: 4,
        activeTier2Count: 4,
        activeTier3Workers: 0,
        totalPendingTasks: 0,
        totalInProgressTasks: 0,
        tier1LoadRatio: 0,
        tier2LoadRatio: 0,
        tier3Utilization: 0,
        recommendedTier1Count: 1,
        recommendedTier2Count: 1,
        scalingDirection: "SCALE_IN",
        reasons: ["Quiescent queue"],
      };

      const decision = evaluateHierarchyScaling(metrics);
      expect(decision.action).toBe("SCALE_IN");
      expect(decision.newTier1Count).toBe(1);
      expect(decision.newTier2Count).toBe(1);
      expect(decision.spawnsRecommended).toEqual([]);
      expect(decision.drainsRecommended).toEqual([]);
    });

    it("handles REBALANCE and STEADY decisions", () => {
      const metrics: HierarchyCapacityMetrics = {
        activeTier1Count: 2,
        activeTier2Count: 2,
        activeTier3Workers: 1,
        totalPendingTasks: 2,
        totalInProgressTasks: 1,
        tier1LoadRatio: 1.5,
        tier2LoadRatio: 1.5,
        tier3Utilization: 0.1,
        recommendedTier1Count: 2,
        recommendedTier2Count: 2,
        scalingDirection: "REBALANCE",
        reasons: ["Imbalance"],
      };

      const rebalDecision = evaluateHierarchyScaling(metrics);
      expect(rebalDecision.action).toBe("REBALANCE");
      expect(rebalDecision.newTier1Count).toBe(2);
      expect(rebalDecision.spawnsRecommended).toEqual([]);

      const steadyMetrics: HierarchyCapacityMetrics = {
        ...metrics,
        scalingDirection: "STEADY",
        reasons: ["Steady capacity"],
      };
      const steadyDecision = evaluateHierarchyScaling(steadyMetrics);
      expect(steadyDecision.action).toBe("STEADY");
      expect(steadyDecision.newTier1Count).toBe(2);
    });
  });
});
