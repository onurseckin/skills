import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scheduleUnlimitedDepthDAG } from "../../../../olt/scripts/src/engine/scheduler/index.ts";
import { topologyState } from "../fixtures.ts";

describe("Unlimited Depth DAG: Scheduling & Invariants", () => {
  describe("scheduleUnlimitedDepthDAG", () => {
    test("schedules standard DAG state into waves with metrics and strict validator pairings", () => {
      const state = topologyState();
      const result = scheduleUnlimitedDepthDAG(state, { default_max_parallel: 4 });

      expect(result.revision).toBe(3);
      expect(result.max_parallel).toBe(4);
      expect(result.waves.length).toBe(2);
      expect(result.metrics.totalTasks).toBe(4);
      expect(result.metrics.maxWaveDepth).toBe(2);
      expect(result.metrics.criticalPathLength).toBe(2);
      expect(result.metrics.unboundedSafetyVerified).toBe(true);
      expect(result.metrics.validatorPairingRate).toBe(1.0);
      expect(result.pairings.length).toBe(4);
      expect(result.pairings.every((p) => p.isPaired)).toBe(true);
      expect(result.decisions.length).toBe(4);
    });

    test("schedules arbitrarily deep linear DAG of 20 waves seamlessly", () => {
      const tasksRecord: Record<string, Record<string, unknown>> = {};
      const edges: { source: string; target: string; type: string }[] = [];

      for (let i = 1; i <= 20; i++) {
        const id = `deep-task-${i}`;
        const prereqs = i === 1 ? [] : [`deep-task-${i - 1}`];
        tasksRecord[id] = {
          id,
          priority: 1,
          created_order: i,
          effort: 1,
          requirement_ids: ["R-001"],
          write_scope: [`src/deep/step_${i}.ts`],
          resource_scope: [],
          status: "ready",
          dependencies: prereqs,
        };
        if (i > 1) {
          edges.push({
            source: id,
            target: `deep-task-${i - 1}`,
            type: "depends_on",
          });
        }
      }

      const deepState = {
        graph: {
          schema: "harness.graph",
          version: 1,
          revision: 1,
          nodes: Object.keys(tasksRecord).map((id) => ({
            id,
            type: "task",
            requirement_ids: ["R-001"],
          })),
          edges,
          gates: [],
        },
        requirements: {
          schema: "harness.requirements",
          version: 1,
          prompt_sha256: "0".repeat(64),
          requirements: [{ id: "R-001", disposition: "actionable", dependencies: [] }],
          dispositions: [],
        },
        tasks: tasksRecord,
      };

      const result = scheduleUnlimitedDepthDAG(deepState, { default_max_parallel: 4 });

      expect(result.waves.length).toBe(20);
      expect(result.metrics.maxWaveDepth).toBe(20);
      expect(result.metrics.criticalPathLength).toBe(20);
      expect(result.metrics.totalTasks).toBe(20);
      expect(result.metrics.unboundedSafetyVerified).toBe(true);
      expect(result.metrics.validatorPairingRate).toBe(1.0);
      expect(result.waves[0]!.taskIds).toEqual(["deep-task-1"]);
      expect(result.waves[19]!.taskIds).toEqual(["deep-task-20"]);
    });

    test("records agent-reported rationales when supplied", () => {
      const state = topologyState();
      const customRationale = "Custom manual prioritization rationale";
      const result = scheduleUnlimitedDepthDAG(state, {
        default_max_parallel: 4,
        rationales: { "t-alpha": customRationale },
      });

      const alphaDecision = result.decisions.find((d) => d.task_id === "t-alpha");
      expect(alphaDecision).toBeDefined();
      expect(alphaDecision?.rationale).toBe(customRationale);
      expect(alphaDecision?.evidence_class).toBe("agent_reported");
    });

    test("throws INVALID_STATE when graph revision is missing", () => {
      const invalidState = {
        graph: { revision: 0 },
        tasks: {},
      };

      expect(() => scheduleUnlimitedDepthDAG(invalidState)).toThrow(
        "graph revision is required to schedule DAG",
      );
    });

    test("scheduleUnlimitedDepthDAG validates options and enforces depth invariants", () => {
      const state = topologyState();
      expect(() => scheduleUnlimitedDepthDAG(state, { default_max_parallel: -1 })).toThrow(
        /default_max_parallel must be a positive integer/,
      );
      expect(() => scheduleUnlimitedDepthDAG(null)).toThrow(
        /a plan must be applied before DAG can be scheduled/,
      );
      expect(() => scheduleUnlimitedDepthDAG(state, { max_depth: 1 })).toThrow(
        /Depth invariant violated/,
      );
    });
  });

  describe("Static Invariants & Typing", () => {
    test("index.ts contains 0 any types and 0 linter/compiler suppressions", () => {
      const filePath = join(
        import.meta.dir,
        "../../../../olt/scripts/src/engine/scheduler/index.ts",
      );
      const content = readFileSync(filePath, "utf-8");

      expect(content).not.toMatch(/: any\b/);
      expect(content).not.toMatch(/as any\b/);
      expect(content).not.toMatch(/<any>/);
      expect(content).not.toMatch(/@ts-ignore/);
      expect(content).not.toMatch(/@ts-expect-error/);
      expect(content).not.toMatch(/@ts-nocheck/);
      expect(content).not.toMatch(/eslint-disable/);
    });
  });
});
