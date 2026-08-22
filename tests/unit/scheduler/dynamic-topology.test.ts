import { describe, expect, test } from "bun:test";
import {
  computeWorkSpanMetrics,
  partitionOrchestratorDomains,
  calculateValidatorAllocations,
  calculateCriticConcurrency,
  synthesizeDynamicTopology,
} from "../../../orchestrating-long-tasks/scripts/src/scheduler/index.ts";
import { schedulerState, topologyState } from "./fixtures.ts";

describe("Dynamic Topology Synthesis", () => {
  describe("computeWorkSpanMetrics", () => {
    test("computes work and span correctly for linear chain", () => {
      const deps = new Map([
        ["t1", new Set<string>()],
        ["t2", new Set(["t1"])],
        ["t3", new Set(["t2"])],
      ]);
      const tasks = new Map([
        ["t1", { id: "t1", priority: 1, created_order: 1, effort: 2, requirement_ids: [], write_scope: [] }],
        ["t2", { id: "t2", priority: 1, created_order: 2, effort: 3, requirement_ids: [], write_scope: [] }],
        ["t3", { id: "t3", priority: 1, created_order: 3, effort: 1, requirement_ids: [], write_scope: [] }],
      ]);

      const metrics = computeWorkSpanMetrics(deps, tasks);
      expect(metrics.work).toBe(6);
      expect(metrics.span).toBe(6);
      expect(metrics.parallelismFactor).toBe(1);
      expect(metrics.criticalPath).toEqual(["t1", "t2", "t3"]);
      expect(metrics.minWaves).toBe(3);
    });

    test("computes work, span and speedup factor for diamond parallel graph", () => {
      const deps = new Map([
        ["root", new Set<string>()],
        ["branch-a", new Set(["root"])],
        ["branch-b", new Set(["root"])],
        ["branch-c", new Set(["root"])],
        ["join", new Set(["branch-a", "branch-b", "branch-c"])],
      ]);
      const tasks = new Map([
        ["root", { id: "root", priority: 1, created_order: 1, effort: 1, requirement_ids: [], write_scope: [] }],
        ["branch-a", { id: "branch-a", priority: 1, created_order: 2, effort: 4, requirement_ids: [], write_scope: [] }],
        ["branch-b", { id: "branch-b", priority: 1, created_order: 3, effort: 2, requirement_ids: [], write_scope: [] }],
        ["branch-c", { id: "branch-c", priority: 1, created_order: 4, effort: 1, requirement_ids: [], write_scope: [] }],
        ["join", { id: "join", priority: 1, created_order: 5, effort: 1, requirement_ids: [], write_scope: [] }],
      ]);

      const metrics = computeWorkSpanMetrics(deps, tasks);
      expect(metrics.work).toBe(9);
      expect(metrics.span).toBe(6); // root (1) + branch-a (4) + join (1)
      expect(metrics.parallelismFactor).toBe(1.5);
      expect(metrics.criticalPath).toEqual(["root", "branch-a", "join"]);
      expect(metrics.minWaves).toBe(3);
    });
  });

  describe("partitionOrchestratorDomains", () => {
    test("partitions tasks into domain clusters based on write scopes", () => {
      const tasks = [
        { id: "ui-task-1", priority: 1, created_order: 1, effort: 1, requirement_ids: [], write_scope: ["src/ui/Button.tsx"] },
        { id: "ui-task-2", priority: 1, created_order: 2, effort: 1, requirement_ids: [], write_scope: ["src/ui/Nav.tsx"] },
        { id: "sys-task-1", priority: 1, created_order: 3, effort: 2, requirement_ids: [], write_scope: ["src/contracts/schema.graphql"] },
        { id: "core-task-1", priority: 1, created_order: 4, effort: 1, requirement_ids: [], write_scope: ["src/utils/math.ts"] },
      ];
      const deps = new Map([
        ["ui-task-1", new Set<string>()],
        ["ui-task-2", new Set<string>()],
        ["sys-task-1", new Set<string>()],
        ["core-task-1", new Set<string>()],
      ]);

      const partitions = partitionOrchestratorDomains(tasks, deps);
      expect(partitions.length).toBeGreaterThanOrEqual(3);
      const frontendPart = partitions.find((p) => p.domain === "frontend-ui");
      expect(frontendPart).toBeDefined();
      expect(frontendPart?.taskIds).toEqual(["ui-task-1", "ui-task-2"]);

      const backendPart = partitions.find((p) => p.domain === "backend-system");
      expect(backendPart).toBeDefined();
      expect(backendPart?.taskIds).toEqual(["sys-task-1"]);

      const corePart = partitions.find((p) => p.domain === "core-engine");
      expect(corePart).toBeDefined();
      expect(corePart?.taskIds).toEqual(["core-task-1"]);
    });

    test("identifies cross-orchestrator partition dependencies", () => {
      const tasks = [
        { id: "schema-task", priority: 1, created_order: 1, effort: 2, requirement_ids: [], write_scope: ["src/contracts/schema.proto"] },
        { id: "ui-task", priority: 1, created_order: 2, effort: 1, requirement_ids: [], write_scope: ["src/components/View.tsx"] },
      ];
      const deps = new Map([
        ["schema-task", new Set<string>()],
        ["ui-task", new Set(["schema-task"])],
      ]);

      const partitions = partitionOrchestratorDomains(tasks, deps);
      const uiPart = partitions.find((p) => p.domain === "frontend-ui");
      expect(uiPart).toBeDefined();
      expect(uiPart?.dependencies).toContain("orchestrator-domain-backend-system");
    });
  });

  describe("calculateValidatorAllocations", () => {
    test("calculates validator demand and fleet sizing based on task write scopes", () => {
      const tasks = [
        { id: "t1", priority: 1, created_order: 1, effort: 1, requirement_ids: [], write_scope: ["src/index.ts"] },
        { id: "t2", priority: 1, created_order: 2, effort: 1, requirement_ids: [], write_scope: ["src/view.tsx"] },
        { id: "t3", priority: 1, created_order: 3, effort: 1, requirement_ids: [], write_scope: ["src/schema.graphql"] },
      ];

      const { demands, fleet } = calculateValidatorAllocations(tasks);
      expect(fleet["code-quality"]).toBeGreaterThanOrEqual(1);
      expect(fleet["ui-design"]).toBeGreaterThanOrEqual(1);
      expect(fleet["system-design"]).toBeGreaterThanOrEqual(1);

      const codeQual = demands.find((d) => d.domain === "code-quality");
      expect(codeQual?.taskCount).toBe(3);
    });
  });

  describe("calculateCriticConcurrency", () => {
    test("sizes critic concurrency dynamically bounded between 1 and 4", () => {
      expect(calculateCriticConcurrency(0, 1, 1)).toBe(1);
      expect(calculateCriticConcurrency(2, 1, 1)).toBe(1);
      expect(calculateCriticConcurrency(10, 2, 3)).toBe(3);
      expect(calculateCriticConcurrency(50, 2, 8)).toBe(4);
    });
  });

  describe("synthesizeDynamicTopology", () => {
    test("synthesizes complete dynamic topology with work/span, partitions, barriers, and fleets", () => {
      const state = topologyState();
      const synthesis = synthesizeDynamicTopology(state, { default_max_parallel: 4 });

      expect(synthesis.revision).toBe(3);
      expect(synthesis.max_parallel).toBe(4);
      expect(synthesis.work).toBe(4);
      expect(synthesis.span).toBe(2);
      expect(synthesis.parallelismFactor).toBe(2);
      expect(synthesis.criticalPath).toEqual(["t-alpha", "t-gamma"]);
      expect(synthesis.recommendedWorkerFleetSize).toBeGreaterThanOrEqual(2);
      expect(synthesis.recommendedValidatorFleet["code-quality"]).toBeGreaterThanOrEqual(1);
      expect(synthesis.recommendedCriticConcurrency).toBeGreaterThanOrEqual(1);
      expect(synthesis.orchestratorPartitions.length).toBeGreaterThan(0);
      expect(synthesis.waves.length).toBe(2);
      expect(synthesis.decisions.length).toBe(4);
    });

    test("records cross-orchestrator synchronization barriers when dependencies cross domains", () => {
      const state = topologyState();
      const tasks = state.tasks as Record<string, Record<string, unknown>>;
      tasks["t-alpha"]!.write_scope = ["src/contracts/schema.graphql"];
      tasks["t-gamma"]!.write_scope = ["src/ui/View.tsx"];

      const synthesis = synthesizeDynamicTopology(state, { default_max_parallel: 4 });
      expect(synthesis.crossOrchestratorBarriers.length).toBeGreaterThanOrEqual(1);
      const barrier = synthesis.crossOrchestratorBarriers[0]!;
      expect(barrier.prerequisiteTaskId).toBe("t-alpha");
      expect(barrier.dependentTaskId).toBe("t-gamma");
    });

    test("throws HarnessError on invalid state or missing revision", () => {
      expect(() => synthesizeDynamicTopology({}, { default_max_parallel: 4 })).toThrow(
        "a plan must be applied before topology is synthesized",
      );
    });
  });
});
