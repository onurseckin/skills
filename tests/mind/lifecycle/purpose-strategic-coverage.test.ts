import { describe, expect, it } from "bun:test";
import {
  diagnoseMacroDag,
  groomBacklog,
} from "../../../olt/scripts/src/mind/lifecycle/purpose/strategic.ts";
import type {
  MacroDagTaskNode,
  BacklogGroomingItem,
} from "../../../olt/scripts/src/mind/lifecycle/purpose/types.ts";

describe("Mind Strategic Diagnostics & Backlog Grooming Suite (strategic.ts)", () => {
  describe("diagnoseMacroDag", () => {
    it("returns baseline diagnostics for empty execution graph", () => {
      const result = diagnoseMacroDag({});
      expect(result.totalNodes).toBe(0);
      expect(result.readyNodes).toBe(0);
      expect(result.leasedNodes).toBe(0);
      expect(result.completedNodes).toBe(0);
      expect(result.failedNodes).toBe(0);
      expect(result.criticalPathLength).toBe(0);
      expect(result.totalWorkMs).toBe(0);
      expect(result.criticalSpanMs).toBe(0);
      expect(result.workSpanRatio).toBe(1.0);
      expect(result.concurrencyRecommendation).toBe(1);
      expect(result.bottlenecks).toEqual([]);
      expect(result.subagentAllocations).toEqual({});
    });

    it("analyzes multi-node DAG topology with critical path and work/span metrics", () => {
      const nodes: MacroDagTaskNode[] = [
        {
          taskId: "t1",
          role: "planner",
          status: "completed",
          durationEstimateMs: 30000,
          dependencies: [],
        },
        {
          taskId: "t2",
          role: "implementer",
          status: "completed",
          durationEstimateMs: 60000,
          dependencies: ["t1"],
        },
        {
          taskId: "t3",
          role: "implementer",
          status: "leased",
          durationEstimateMs: 60000,
          dependencies: ["t1"],
        },
        {
          taskId: "t4",
          role: "validator",
          status: "ready",
          durationEstimateMs: 30000,
          dependencies: ["t2", "t3"],
        },
      ];

      const result = diagnoseMacroDag({ nodes, defaultTaskDurationMs: 40000 });
      expect(result.totalNodes).toBe(4);
      expect(result.completedNodes).toBe(2);
      expect(result.leasedNodes).toBe(1);
      expect(result.readyNodes).toBe(1);
      expect(result.failedNodes).toBe(0);
      expect(result.criticalPathLength).toBe(3); // t1 -> t2/t3 -> t4
      expect(result.totalWorkMs).toBe(180000); // 30k + 60k + 60k + 30k
      expect(result.criticalSpanMs).toBe(3 * 40000); // 120000
      expect(result.workSpanRatio).toBe(1.5); // 180k / 120k
      expect(result.concurrencyRecommendation).toBe(2);
      expect(result.subagentAllocations).toEqual({
        planner: 1,
        implementer: 2,
        validator: 1,
      });
    });

    it("handles dependency cycles safely without infinite recursion", () => {
      const cycleNodes: MacroDagTaskNode[] = [
        { taskId: "a", role: "worker", status: "ready", dependencies: ["b"] },
        { taskId: "b", role: "worker", status: "ready", dependencies: ["a"] },
      ];
      const result = diagnoseMacroDag({ nodes: cycleNodes });
      expect(result.totalNodes).toBe(2);
      expect(result.criticalPathLength).toBeGreaterThanOrEqual(1);
    });

    it("detects fan-in, fan-out, and failed node bottlenecks", () => {
      const nodes: MacroDagTaskNode[] = [
        // High fan-out root node (unblocks f1, f2, f3, f4)
        { taskId: "root", role: "coordinator", status: "completed", dependencies: [] },
        { taskId: "f1", role: "impl", status: "completed", dependencies: ["root"] },
        { taskId: "f2", role: "impl", status: "completed", dependencies: ["root"] },
        { taskId: "f3", role: "impl", status: "completed", dependencies: ["root"] },
        { taskId: "f4", role: "impl", status: "completed", dependencies: ["root"] },
        // High fan-in convergence node (depends on f1, f2, f3, f4)
        {
          taskId: "sink",
          role: "validator",
          status: "ready",
          dependencies: ["f1", "f2", "f3", "f4"],
        },
        // Failed task
        { taskId: "broken", role: "repairer", status: "failed", dependencies: [] },
      ];

      const result = diagnoseMacroDag({ nodes });
      expect(result.failedNodes).toBe(1);

      const fanOut = result.bottlenecks.find((b) => b.type === "fan_out");
      expect(fanOut).toBeDefined();
      expect(fanOut?.taskId).toBe("root");
      expect(fanOut?.description).toContain("High fan-out bottleneck");

      const fanIn = result.bottlenecks.find((b) => b.type === "fan_in");
      expect(fanIn).toBeDefined();
      expect(fanIn?.taskId).toBe("sink");
      expect(fanIn?.description).toContain("High fan-in convergence point");

      const critPath = result.bottlenecks.find((b) => b.type === "critical_path");
      expect(critPath).toBeDefined();
      expect(critPath?.taskId).toBe("broken");
      expect(critPath?.suggestedMitigation).toContain("Dispatch repairer lane");
    });
  });

  describe("groomBacklog", () => {
    it("grooms empty backlog with zero statistics", () => {
      const result = groomBacklog({});
      expect(result.scannedCount).toBe(0);
      expect(result.actionableCount).toBe(0);
      expect(result.dormantCount).toBe(0);
      expect(result.reconciledCount).toBe(0);
      expect(result.prunedCount).toBe(0);
      expect(result.items).toEqual([]);
      expect(result.strategicPriorities).toEqual([]);
      expect(result.groomingSummary).toContain("Backlog groomed: 0 total items");
    });

    it("applies default attributes for partial backlog items", () => {
      const raw = [{ title: "Auto item" }, {}];
      const result = groomBacklog({ rawItems: raw });

      expect(result.scannedCount).toBe(2);
      expect(result.actionableCount).toBe(2);
      expect(result.items[0].id).toBe("backlog-item-1");
      expect(result.items[0].title).toBe("Auto item");
      expect(result.items[0].category).toBe("COGNITIVE_GAP");
      expect(result.items[0].priority).toBe("MEDIUM");
      expect(result.items[0].source).toBe("mind-supervisory-pulse");
      expect(result.items[0].status).toBe("actionable");

      expect(result.items[1].id).toBe("backlog-item-2");
      expect(result.items[1].title).toBe("Groomed Backlog Item");
    });

    it("categorizes statuses and sorts actionable strategic priorities by priority hierarchy", () => {
      const raw: Partial<BacklogGroomingItem>[] = [
        {
          id: "item-low",
          title: "Refactor docs",
          priority: "LOW",
          status: "actionable",
          category: "DOCS",
        },
        {
          id: "item-crit",
          title: "Security patch",
          priority: "CRITICAL",
          status: "actionable",
          category: "SECURITY",
        },
        {
          id: "item-dorm",
          title: "Dormant item",
          priority: "HIGH",
          status: "dormant",
          category: "FUTURE",
        },
        {
          id: "item-rec",
          title: "Reconciled task",
          priority: "HIGH",
          status: "reconciled",
          category: "CHRE",
        },
        {
          id: "item-prune",
          title: "Pruned duplicate",
          priority: "LOW",
          status: "pruned",
          category: "DUPLICATE",
        },
        {
          id: "item-high",
          title: "Stabilize concurrency",
          priority: "HIGH",
          status: "actionable",
          category: "RUNTIME",
        },
        {
          id: "item-med",
          title: "Telemetry badges",
          priority: "MEDIUM",
          status: "actionable",
          category: "OBSERVABILITY",
        },
      ];

      const result = groomBacklog({ rawItems: raw });

      expect(result.scannedCount).toBe(7);
      expect(result.actionableCount).toBe(4);
      expect(result.dormantCount).toBe(1);
      expect(result.reconciledCount).toBe(1);
      expect(result.prunedCount).toBe(1);

      expect(result.strategicPriorities).toEqual([
        "[CRITICAL] Security patch (SECURITY)",
        "[HIGH] Stabilize concurrency (RUNTIME)",
        "[MEDIUM] Telemetry badges (OBSERVABILITY)",
        "[LOW] Refactor docs (DOCS)",
      ]);

      expect(result.groomingSummary).toContain("4 actionable, 1 dormant, 1 reconciled, 1 pruned");
      expect(result.groomingSummary).toContain("Top strategic priorities identified: 4");
    });
  });
});
