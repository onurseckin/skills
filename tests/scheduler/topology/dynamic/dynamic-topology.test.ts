import { describe, expect, test } from "bun:test";
import { synthesizeDynamicTopology } from "../../../../olt/scripts/src/engine/scheduler/index.ts";
import { topologyState } from "../../fixtures.ts";

describe("Dynamic Topology: Synthesis & Execution", () => {
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
      expect(barrier.fromPartitionId).toBe("orchestrator-domain-backend-system");
      expect(barrier.toPartitionId).toBe("orchestrator-domain-frontend-ui");
      expect(barrier.wave).toBe(2);
    });

    test("supports agent-reported rationales with evidence_class agent_reported", () => {
      const state = topologyState();
      const synthesis = synthesizeDynamicTopology(state, {
        default_max_parallel: 4,
        rationales: {
          "t-alpha": "Custom reason from lead agent",
        },
      });
      const alphaDecision = synthesis.decisions.find((d) => d.task_id === "t-alpha");
      expect(alphaDecision).toBeDefined();
      expect(alphaDecision?.evidence_class).toBe("agent_reported");
      expect(alphaDecision?.rationale).toBe("Custom reason from lead agent");

      const betaDecision = synthesis.decisions.find((d) => d.task_id === "t-beta");
      expect(betaDecision?.evidence_class).toBe("derived");
    });

    test("handles zero-task state cleanly with default metrics and empty waves", () => {
      const emptyState = {
        graph: {
          schema: "harness.graph",
          version: 1,
          revision: 1,
          nodes: [],
          edges: [],
          gates: [],
        },
        tasks: {},
      };
      const synthesis = synthesizeDynamicTopology(emptyState, { default_max_parallel: 4 });
      expect(synthesis.revision).toBe(1);
      expect(synthesis.work).toBe(1);
      expect(synthesis.span).toBe(1);
      expect(synthesis.parallelismFactor).toBe(1);
      expect(synthesis.criticalPath).toEqual([]);
      expect(synthesis.waves).toEqual([]);
      expect(synthesis.decisions).toEqual([]);
      expect(synthesis.orchestratorPartitions).toEqual([]);
      expect(synthesis.crossOrchestratorBarriers).toEqual([]);
      expect(synthesis.recommendedWorkerFleetSize).toBe(1);
      expect(synthesis.recommendedTier1Orchestrators).toBe(1);
    });

    test("computes resource disjointness and tier recommendations correctly", () => {
      const state = topologyState();
      const synthesis = synthesizeDynamicTopology(state, { default_max_parallel: 4 });

      expect(synthesis.resourceDisjointness).toBeDefined();
      expect(synthesis.resourceDisjointness.disjointComponentCount).toBeGreaterThanOrEqual(1);
      expect(synthesis.resourceDisjointness.disjointnessScore).toBeGreaterThan(0);
      expect(synthesis.recommendedTier1Orchestrators).toBeGreaterThanOrEqual(1);
      expect(synthesis.recommendedTier2Coordinators).toBeGreaterThanOrEqual(1);
    });

    test("throws HarnessError on invalid state or missing revision", () => {
      expect(() => synthesizeDynamicTopology({}, { default_max_parallel: 4 })).toThrow(
        "a plan must be applied before topology is synthesized",
      );
    });

    test("synthesizeDynamicTopology validates options and state revision", () => {
      const state = topologyState();
      expect(() => synthesizeDynamicTopology(state, { default_max_parallel: -1 })).toThrow(
        /default_max_parallel must be a positive integer/,
      );
      expect(() => synthesizeDynamicTopology(state, { default_max_parallel: 0 })).toThrow(
        /default_max_parallel must be a positive integer/,
      );
      expect(() => synthesizeDynamicTopology(state, { default_max_parallel: 2.5 })).toThrow(
        /default_max_parallel must be a positive integer/,
      );
      const invalidRevisionState = { graph: { revision: 0 }, tasks: {} };
      expect(() => synthesizeDynamicTopology(invalidRevisionState)).toThrow(
        /graph revision is required/,
      );
      const unappliedPlanState = { graph: { revision: 1 }, tasks: null };
      expect(() => synthesizeDynamicTopology(unappliedPlanState)).toThrow(
        /a plan must be applied before topology is synthesized/,
      );
    });

    test("throws HarnessError on execution cycles in task dependencies", () => {
      const state = topologyState();
      const graph = state.graph as Record<string, unknown>;
      graph.edges = [
        { source: "t-alpha", target: "t-gamma", type: "depends_on" },
        { source: "t-gamma", target: "t-alpha", type: "depends_on" },
      ];
      expect(() => synthesizeDynamicTopology(state, { default_max_parallel: 4 })).toThrow(
        /graph is not executable/i,
      );
    });

    test("handles tasks with diverse lifecycle statuses without runtime errors", () => {
      const state = topologyState();
      const tasks = state.tasks as Record<string, Record<string, unknown>>;
      tasks["t-alpha"]!.status = "done";
      tasks["t-beta"]!.status = "failed";
      tasks["t-beta-sub"]!.status = "cancelled";
      tasks["t-gamma"]!.status = "ready";

      const synthesis = synthesizeDynamicTopology(state, { default_max_parallel: 4 });
      expect(synthesis.work).toBe(4);
      expect(synthesis.span).toBe(2);
      expect(synthesis.decisions.length).toBeGreaterThanOrEqual(1);
      const gammaDecision = synthesis.decisions.find((d) => d.task_id === "t-gamma");
      expect(gammaDecision).toBeDefined();
      expect(gammaDecision?.wave).toBe(1);
    });

    test("scales safely under large concurrency bounds without integer overflow", () => {
      const state = topologyState();
      const synthesis = synthesizeDynamicTopology(state, { default_max_parallel: 1000 });
      expect(synthesis.max_parallel).toBe(1000);
      expect(synthesis.recommendedWorkerFleetSize).toBeLessThanOrEqual(4);
      expect(synthesis.recommendedTier1Orchestrators).toBeLessThanOrEqual(4);
      expect(synthesis.recommendedTier2Coordinators).toBeGreaterThanOrEqual(1);
    });
  });
});
