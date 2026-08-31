import { describe, expect, test } from "bun:test";
import { synthesizeDynamicTopology } from "../../../olt/scripts/src/engine/scheduler/index.ts";
import { topologyState } from "../fixtures.ts";

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
      const invalidRevisionState = { graph: { revision: 0 }, tasks: {} };
      expect(() => synthesizeDynamicTopology(invalidRevisionState)).toThrow(
        /graph revision is required/,
      );
      const unappliedPlanState = { graph: { revision: 1 }, tasks: null };
      expect(() => synthesizeDynamicTopology(unappliedPlanState)).toThrow(
        /a plan must be applied before topology is synthesized/,
      );
    });
  });
});
