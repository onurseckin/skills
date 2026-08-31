import { describe, expect, test } from "bun:test";
import {
  breakCycles,
  calculateBrentsTheorem,
  computeWorkSpan,
  findCycles,
  isAcyclic,
} from "../../../olt/scripts/src/graph/dag-forensics.ts";
import {
  allocateParallelLanes,
  assertAntiSerializationInterlock,
  computeWorkSpanMetrics,
  decoupleDisjointTasks,
  detectArtificialSerialization,
  partitionDynamicLanes,
  verifyAntiSerializationInterlock,
} from "../../../olt/scripts/src/graph/parallel-decoupler.ts";

describe("Graph Decoupler & Artificial Serialization", () => {
  test("detects artificial serialization between disjoint tasks", () => {
    const tasks = [
      { taskId: "task-1", writeScope: ["src/a.ts"], dependencies: [] },
      { taskId: "task-2", writeScope: ["src/b.ts"], dependencies: ["task-1"] },
    ];
    const warnings = detectArtificialSerialization(tasks);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.blockedTask).toBe("task-2");
    expect(warnings[0]!.dependencyTask).toBe("task-1");
    expect(warnings[0]!.dataflowJustified).toBe(false);
  });

  test("decouples disjoint tasks and prunes artificial edges", () => {
    const graph = {
      nodes: [
        { id: "t1", type: "task", write_scope: ["src/t1.ts"], effort: 10 },
        { id: "t2", type: "task", write_scope: ["src/t2.ts"], effort: 10 },
      ],
      edges: [{ source: "t2", target: "t1", type: "depends_on" }],
    };

    const result = decoupleDisjointTasks(graph);
    expect(result.decoupledEdges).toHaveLength(1);
    expect(result.decoupledEdges[0]!.source).toBe("t2");
    expect(result.decoupledEdges[0]!.target).toBe("t1");
    expect(result.warnings).toHaveLength(1);
    expect(result.metrics.totalWork).toBe(20);
    expect(result.metrics.criticalSpan).toBe(10);
    expect(result.metrics.parallelismFactor).toBe(2);

    const remainingEdges = (result.graph.edges as { source: string; target: string }[]) || [];
    expect(remainingEdges).toHaveLength(0);
  });

  test("preserves dependencies with overlapping write scopes", () => {
    const graph = {
      nodes: [
        { id: "t1", type: "task", write_scope: ["src/common.ts"], effort: 15 },
        { id: "t2", type: "task", write_scope: ["src/common.ts"], effort: 15 },
      ],
      edges: [{ source: "t2", target: "t1", type: "depends_on" }],
    };

    const result = decoupleDisjointTasks(graph);
    expect(result.decoupledEdges).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.metrics.criticalSpan).toBe(30);
  });

  test("preserves justified dependencies when requested", () => {
    const graph = {
      nodes: [
        {
          id: "t1",
          type: "task",
          write_scope: ["src/a.ts"],
          effort: 10,
        },
        {
          id: "t2",
          type: "task",
          write_scope: ["src/b.ts"],
          effort: 10,
          dep_reasons: { t1: "Consumes schema artifact" },
        },
      ],
      edges: [{ source: "t2", target: "t1", type: "depends_on" }],
    };

    const result = decoupleDisjointTasks(graph, { preserveJustified: true });
    expect(result.decoupledEdges).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.dataflowJustified).toBe(true);
  });
});

describe("SCC Cycle Analysis & Feedback Arc Cutting", () => {
  test("isAcyclic correctly verifies DAG acyclicity", () => {
    const cleanDag = new Map([
      ["a", new Set<string>()],
      ["b", new Set(["a"])],
      ["c", new Set(["b"])],
    ]);
    expect(isAcyclic(cleanDag)).toBe(true);

    const cyclic = new Map([
      ["a", new Set(["b"])],
      ["b", new Set(["a"])],
    ]);
    expect(isAcyclic(cyclic)).toBe(false);
  });

  test("findCycles extracts all participating cyclic cycles", () => {
    const multiCycle = new Map([
      ["x", new Set(["y"])],
      ["y", new Set(["z"])],
      ["z", new Set(["x"])],
      ["indep", new Set<string>()],
    ]);
    const cycles = findCycles(multiCycle);
    expect(cycles.length).toBeGreaterThan(0);
    expect(cycles[0]).toContain("x");
    expect(cycles[0]).toContain("y");
    expect(cycles[0]).toContain("z");
  });

  test("breakCycles cuts feedback arcs to restore acyclicity", () => {
    const cyclicGraph = new Map([
      ["node1", new Set(["node2"])],
      ["node2", new Set(["node3"])],
      ["node3", new Set(["node1"])],
    ]);

    const outcome = breakCycles(cyclicGraph);
    expect(outcome.brokenEdges.length).toBeGreaterThan(0);
    expect(isAcyclic(outcome.remainingDag)).toBe(true);
  });
});

describe("Work/Span Metrics & Brent's Theorem", () => {
  test("computes work, critical span, and parallelism factor", () => {
    const tasks = [
      { id: "a", effort: 10, dependencies: [] },
      { id: "b", effort: 20, dependencies: ["a"] },
      { id: "c", effort: 15, dependencies: ["a"] },
      { id: "d", effort: 5, dependencies: ["b", "c"] },
    ];
    const metrics = computeWorkSpanMetrics(tasks);
    expect(metrics.totalWork).toBe(50);
    expect(metrics.criticalSpan).toBe(35);
    expect(metrics.parallelismFactor).toBeCloseTo(50 / 35, 2);
  });

  test("calculateBrentsTheorem computes upper bound execution times", () => {
    const brent = calculateBrentsTheorem({
      totalWork: 100,
      criticalSpan: 20,
      availableProcessors: 4,
    });
    expect(brent.theoreticalDuration).toBe(40);
    expect(brent.speedup).toBe(2.5);
    expect(brent.efficiency).toBe(0.625);
  });

  test("computeWorkSpan calculates total work and span for dependency map", () => {
    const deps = new Map([
      ["t1", new Set<string>()],
      ["t2", new Set(["t1"])],
      ["t3", new Set(["t1"])],
    ]);
    const efforts = new Map([
      ["t1", 10],
      ["t2", 20],
      ["t3", 30],
    ]);
    const ws = computeWorkSpan(deps, efforts);
    expect(ws.totalWork).toBe(60);
    expect(ws.criticalSpan).toBe(40);
  });
});

describe("Lane Allocation & Anti-Serialization Interlock", () => {
  test("allocates parallel lanes for independent tasks", () => {
    const waves = [
      { waveIndex: 0, taskIds: ["t1", "t2", "t3"] },
      { waveIndex: 1, taskIds: ["t4", "t5"] },
    ];
    const lanes = allocateParallelLanes(waves, 2);
    expect(lanes.length).toBe(5);
    const wave0Lanes = lanes.filter((l) => l.waveIndex === 0);
    expect(wave0Lanes.map((l) => l.laneIndex).sort()).toEqual([0, 1, 2]);
  });

  test("partitionDynamicLanes distributes tasks across bounded lanes", () => {
    const tasks = [
      { taskId: "t1", effort: 10, wave: 0 },
      { taskId: "t2", effort: 20, wave: 0 },
      { taskId: "t3", effort: 15, wave: 0 },
    ];
    const partitioned = partitionDynamicLanes(tasks, 2);
    expect(partitioned.length).toBe(3);
    const laneIndices = new Set(partitioned.map((p) => p.laneIndex));
    expect(laneIndices.size).toBeLessThanOrEqual(2);
  });

  test("verifyAntiSerializationInterlock and assertAntiSerializationInterlock", () => {
    const cleanTasks = [
      { taskId: "a", writeScope: ["src/a.ts"], dependencies: [] },
      { taskId: "b", writeScope: ["src/b.ts"], dependencies: [] },
    ];
    expect(verifyAntiSerializationInterlock(cleanTasks).passed).toBe(true);
    expect(() => assertAntiSerializationInterlock(cleanTasks)).not.toThrow();

    const serializedTasks = [
      { taskId: "a", writeScope: ["src/a.ts"], dependencies: [] },
      { taskId: "b", writeScope: ["src/b.ts"], dependencies: ["a"] },
    ];
    expect(verifyAntiSerializationInterlock(serializedTasks).passed).toBe(false);
    expect(() => assertAntiSerializationInterlock(serializedTasks)).toThrow();
  });
});
