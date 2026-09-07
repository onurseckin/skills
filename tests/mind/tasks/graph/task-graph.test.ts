import { describe, expect, it } from "bun:test";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  compileSmartTasksToWavePlan,
  evaluateSmartHierarchy,
  partitionIntoDisjointWaves,
  planMultiCoordinatorWaves,
  planWaveExecution,
} from "../../../../olt/scripts/src/mind/tasks/smart/planner/waves.ts";
import type { SmartTaskPlan } from "../../../../olt/scripts/src/mind/tasks/smart/planner/models.ts";

describe("Mind Tasks: Task Graph & Wave Planning", () => {
  const makePlan = (
    id: string,
    dependencies: string[] = [],
    writeScope: string[] = [`src/${id}.ts`],
  ): SmartTaskPlan => ({
    id,
    label: `Plan ${id}`,
    write_scope: writeScope,
    gate: "bun test",
    charter_goals: ["G1"],
    acceptance_criteria: ["Pass"],
    dependencies,
    source_type: "direct_prompt",
    priority: "HIGH",
    rationale: "Rationale",
    assigned_tier: "Tier_3_Implementer",
  });

  describe("planWaveExecution - Graph Topology & Waves", () => {
    it("handles empty task list gracefully with zero metrics", () => {
      const result = planWaveExecution([]);
      expect(result.total_waves).toBe(0);
      expect(result.total_tasks).toBe(0);
      expect(result.waves).toEqual([]);
      expect(result.macro_metrics.work).toBe(0);
      expect(result.macro_metrics.span).toBe(0);
      expect(result.optimal_lanes).toBe(1);
    });

    it("detects circular dependencies and throws HarnessError INTEGRITY", () => {
      const taskA = makePlan("task-a", ["task-b"]);
      const taskB = makePlan("task-b", ["task-a"]);

      expect(() => planWaveExecution([taskA, taskB])).toThrow(HarnessError);

      try {
        planWaveExecution([taskA, taskB]);
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(HarnessError);
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe("INTEGRITY");
        expect(harnessErr.message).toContain("Circular dependency detected involving task");
      }
    });

    it("orders tasks by topological depth into sequential waves", () => {
      const task1 = makePlan("t1", []);
      const task2 = makePlan("t2", ["t1"]);
      const task3 = makePlan("t3", ["t2"]);

      const result = planWaveExecution([task3, task1, task2]);
      expect(result.total_tasks).toBe(3);
      expect(result.total_waves).toBe(3);
      expect(result.waves[0]?.task_ids).toEqual(["t1"]);
      expect(result.waves[1]?.task_ids).toEqual(["t2"]);
      expect(result.waves[2]?.task_ids).toEqual(["t3"]);
    });

    it("bundles disjoint independent tasks into parallel lanes in the same wave", () => {
      const taskA = makePlan("t-a", [], ["src/a.ts"]);
      const taskB = makePlan("t-b", [], ["src/b.ts"]);
      const taskC = makePlan("t-c", [], ["src/c.ts"]);

      const result = planWaveExecution([taskA, taskB, taskC]);
      expect(result.total_tasks).toBe(3);
      expect(result.total_waves).toBe(1);
      expect(result.waves[0]?.task_ids).toHaveLength(3);
      expect(result.macro_metrics.parallelism).toBeGreaterThanOrEqual(1);
    });

    it("serializes tasks with overlapping write scopes into successive sub-waves", () => {
      const task1 = makePlan("t-write-1", [], ["src/shared/state.ts"]);
      const task2 = makePlan("t-write-2", [], ["src/shared/state.ts"]);

      const result = planWaveExecution([task1, task2]);
      expect(result.total_tasks).toBe(2);
      expect(result.total_waves).toBe(2);
      expect(result.waves[0]?.task_ids).toEqual(["t-write-1"]);
      expect(result.waves[1]?.task_ids).toEqual(["t-write-2"]);
    });

    it("computes macro metrics work, span, parallelism, and efficiency", () => {
      const taskA = makePlan("tA", []);
      const taskB = makePlan("tB", ["tA"]);

      const result = planWaveExecution([taskA, taskB]);
      expect(result.macro_metrics.work).toBeGreaterThan(0);
      expect(result.macro_metrics.span).toBeGreaterThan(0);
      expect(result.macro_metrics.parallelism).toBeGreaterThan(0);
      expect(result.macro_metrics.efficiency).toBeGreaterThan(0);
    });
  });

  describe("Multi-Coordinator Partitioning & Hierarchy", () => {
    it("evaluates hierarchy scaling across task counts", () => {
      const tasks = [makePlan("t1"), makePlan("t2"), makePlan("t3")];
      const hierarchy = evaluateSmartHierarchy(tasks, {
        waveLanes: 2,
        maxLanesPerCoordinator: 4,
      });
      expect(hierarchy.requiredCoordinators).toBeGreaterThanOrEqual(1);
      expect(hierarchy.maxLanesPerCoordinator).toBe(4);
      expect(hierarchy.optimalLanes).toBe(2);
    });

    it("partitions waves across coordinators via planMultiCoordinatorWaves", () => {
      const tasks = [makePlan("t1"), makePlan("t2")];
      const wavePlan = planWaveExecution(tasks);
      const partitions = planMultiCoordinatorWaves(wavePlan);

      expect(partitions.length).toBe(wavePlan.waves.length);
      expect(partitions[0]?.partitions.length).toBeGreaterThanOrEqual(1);
    });

    it("aliases compileSmartTasksToWavePlan and partitionIntoDisjointWaves cleanly", () => {
      const tasks = [makePlan("t1")];
      const p1 = compileSmartTasksToWavePlan(tasks);
      const p2 = partitionIntoDisjointWaves(tasks);

      expect(p1.total_waves).toBe(1);
      expect(p2.total_waves).toBe(1);
      expect(p1.waves[0]?.task_ids).toEqual(["t1"]);
      expect(p2.waves[0]?.task_ids).toEqual(["t1"]);
    });
  });

  describe("Adversarial Probes: Diamond Dependencies, Deep Cycles & Hierarchical Scopes", () => {
    it("detects self-referential cycle and throws HarnessError INTEGRITY", () => {
      const selfTask = makePlan("task-self", ["task-self"]);
      expect(() => planWaveExecution([selfTask])).toThrow(HarnessError);
    });

    it("detects indirect multi-node cycle (A -> B -> C -> D -> A)", () => {
      const tA = makePlan("tA", ["tD"]);
      const tB = makePlan("tB", ["tA"]);
      const tC = makePlan("tC", ["tB"]);
      const tD = makePlan("tD", ["tC"]);
      expect(() => planWaveExecution([tA, tB, tC, tD])).toThrow(HarnessError);
    });

    it("executes diamond graph with concurrent intermediate branch waves", () => {
      const tRoot = makePlan("tRoot", [], ["src/root.ts"]);
      const tBranchA = makePlan("tBranchA", ["tRoot"], ["src/branch-a.ts"]);
      const tBranchB = makePlan("tBranchB", ["tRoot"], ["src/branch-b.ts"]);
      const tJoin = makePlan("tJoin", ["tBranchA", "tBranchB"], ["src/join.ts"]);

      const result = planWaveExecution([tJoin, tBranchB, tRoot, tBranchA]);
      expect(result.total_waves).toBe(3);
      expect(result.waves[0]?.task_ids).toEqual(["tRoot"]);
      expect(result.waves[1]?.tasks).toHaveLength(2);
      expect(result.waves[1]?.task_ids).toEqual(expect.arrayContaining(["tBranchA", "tBranchB"]));
      expect(result.waves[2]?.task_ids).toEqual(["tJoin"]);
    });

    it("serializes sub-tree hierarchical scope overlaps into separate waves", () => {
      const tParentScope = makePlan("tParentScope", [], ["src/mind/tasks"]);
      const tChildScope = makePlan(
        "tChildScope",
        [],
        ["src/mind/tasks/smart/executor/dispatch.ts"],
      );

      const result = planWaveExecution([tParentScope, tChildScope]);
      expect(result.total_waves).toBe(2);
      expect(result.waves[0]?.task_ids).toEqual(["tParentScope"]);
      expect(result.waves[1]?.task_ids).toEqual(["tChildScope"]);
    });

    it("resolves deep 10-node linear pipeline into sequential waves with unitary parallelism", () => {
      const tasks: SmartTaskPlan[] = [];
      for (let i = 1; i <= 10; i++) {
        tasks.push(makePlan(`linear-${i}`, i > 1 ? [`linear-${i - 1}`] : []));
      }
      const plan = planWaveExecution(tasks);
      expect(plan.total_waves).toBe(10);
      expect(plan.total_tasks).toBe(10);
      expect(plan.macro_metrics.work).toBe(10);
      expect(plan.macro_metrics.span).toBe(10);
      expect(plan.macro_metrics.parallelism).toBe(1);
      expect(plan.macro_metrics.efficiency).toBe(1);
      for (let w = 0; w < 10; w++) {
        expect(plan.waves[w]?.task_ids).toEqual([`linear-${w + 1}`]);
      }
    });

    it("resolves convergent fan-in topology grouping disjoint roots in parallel before aggregator", () => {
      const roots = [1, 2, 3, 4].map((i) => makePlan(`root-${i}`, [], [`src/root-${i}.ts`]));
      const aggregator = makePlan(
        "aggregator",
        roots.map((r) => r.id),
        ["src/agg.ts"],
      );

      const plan = planWaveExecution([...roots, aggregator]);
      expect(plan.total_waves).toBe(2);
      expect(plan.waves[0]?.tasks).toHaveLength(4);
      expect(plan.waves[0]?.task_ids).toEqual(
        expect.arrayContaining(["root-1", "root-2", "root-3", "root-4"]),
      );
      expect(plan.waves[1]?.task_ids).toEqual(["aggregator"]);
      expect(plan.macro_metrics.parallelism).toBeGreaterThan(1);
    });

    it("serializes all-to-all write scope collisions into distinct sequential waves", () => {
      const t1 = makePlan("mut-1", [], ["src/shared/mutex.ts"]);
      const t2 = makePlan("mut-2", [], ["src/shared/mutex.ts"]);
      const t3 = makePlan("mut-3", [], ["src/shared/mutex.ts"]);

      const plan = planWaveExecution([t1, t2, t3]);
      expect(plan.total_waves).toBe(3);
      expect(plan.macro_metrics.span).toBe(1);
      for (let w = 0; w < 3; w++) {
        expect(plan.waves[w]?.task_ids).toHaveLength(1);
      }
    });

    it("evaluates zero-span single-task trivial DAG boundary cleanly", () => {
      const single = makePlan("t-single", [], []);
      const plan = planWaveExecution([single]);
      expect(plan.total_waves).toBe(1);
      expect(plan.macro_metrics.work).toBe(1);
      expect(plan.macro_metrics.span).toBe(1);
      expect(plan.macro_metrics.parallelism).toBe(1);
      expect(plan.macro_metrics.efficiency).toBe(1);
    });
  });
});
