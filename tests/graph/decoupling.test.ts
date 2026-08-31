import { describe, expect, it } from "bun:test";
import {
  allocateParallelLanes,
  assertAntiSerializationInterlock,
  computeWorkSpanMetrics,
  evaluateHierarchyScaling,
  FALSE_SERIALIZATION_DEFECT,
  formatParallelSubagentsDispatchArray,
  inferStackOrDomain,
  isFastPathCompactionEligible,
  MAX_LANES_PER_COORDINATOR,
  verifyAntiSerializationInterlock,
} from "../../olt/scripts/src/graph/lane-allocator.ts";
import {
  ARTIFICIAL_SERIALIZATION_WARNING,
  decoupleDisjointTasks,
  detectArtificialSerialization,
  partitionDynamicLanes,
  partitionWaveCoordinators,
} from "../../olt/scripts/src/graph/wave-partitioner.ts";

describe("Lane Allocator & Work-Span Metrics", () => {
  it("computes work-span metrics correctly for sequential and parallel tasks", () => {
    const tasks = [
      { id: "task-1", effort: 5, dependencies: [] },
      { id: "task-2", effort: 10, dependencies: ["task-1"] },
      { id: "task-3", effort: 10, dependencies: ["task-1"] },
    ];
    const metrics = computeWorkSpanMetrics(tasks);
    expect(metrics.totalWork).toBe(25);
    expect(metrics.criticalSpan).toBe(15);
    expect(metrics.parallelismFactor).toBe(1.67);
    expect(metrics.optimalLanes).toBe(2);
  });

  it("handles empty task sets safely", () => {
    const metrics = computeWorkSpanMetrics([]);
    expect(metrics.totalWork).toBe(0);
    expect(metrics.criticalSpan).toBe(0);
    expect(metrics.parallelismFactor).toBe(0);
  });

  it("allocates parallel lanes across wave indices", () => {
    const tasks = [
      { taskId: "t1", writeScope: ["src/a.ts"], dependencies: [] },
      { taskId: "t2", writeScope: ["src/b.ts"], dependencies: [] },
      { taskId: "t3", writeScope: ["src/c.ts"], dependencies: ["t1"] },
    ];
    const assignments = allocateParallelLanes(tasks, 2);
    expect(assignments.length).toBe(3);
    const t1 = assignments.find((a) => a.taskId === "t1");
    const t2 = assignments.find((a) => a.taskId === "t2");
    const t3 = assignments.find((a) => a.taskId === "t3");
    expect(t1?.waveIndex).toBe(0);
    expect(t2?.waveIndex).toBe(0);
    expect(t3?.waveIndex).toBe(1);
  });

  it("evaluates fast path compaction eligibility", () => {
    expect(isFastPathCompactionEligible(1)).toBe(true);
    expect(isFastPathCompactionEligible(["task-1"])).toBe(true);
    expect(isFastPathCompactionEligible(2)).toBe(false);
    expect(isFastPathCompactionEligible([])).toBe(false);
  });

  it("evaluates hierarchy scaling for fast path, standard, and multi coordinator", () => {
    const fastPath = evaluateHierarchyScaling({ taskCount: 1 });
    expect(fastPath.path).toBe("fast_path_compaction");
    expect(fastPath.requiredCoordinators).toBe(0);

    const standard = evaluateHierarchyScaling({ taskCount: 4, waveLanes: 4 });
    expect(standard.path).toBe("standard_coordinator");
    expect(standard.requiredCoordinators).toBe(1);

    const multi = evaluateHierarchyScaling({ taskCount: 12, waveLanes: 12 });
    expect(multi.path).toBe("multi_coordinator_expansion");
    expect(multi.requiredCoordinators).toBe(3);
  });

  it("infers domain and technology stack from file paths", () => {
    expect(inferStackOrDomain("src/ui/Button.tsx")).toBe("ui");
    expect(inferStackOrDomain("src/cli/commands/run.ts")).toBe("cli");
    expect(inferStackOrDomain("src/db/schema.prisma")).toBe("database");
    expect(inferStackOrDomain("main.py")).toBe("python");
    expect(inferStackOrDomain("lib.rs")).toBe("rust");
    expect(inferStackOrDomain("main.go")).toBe("go");
    expect(inferStackOrDomain("src/engine/kernel.ts")).toBe("core");
  });

  it("formats parallel subagent dispatch array", () => {
    const items = formatParallelSubagentsDispatchArray([
      { taskId: "task-1", label: "Task One", zero_exploration_prompt: "Do task 1" },
      "task-2",
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]?.TypeName).toBe("self");
    expect(items[0]?.Role).toContain("Task One");
    expect(items[0]?.Prompt).toBe("Do task 1");
    expect(items[1]?.Role).toContain("task-2");
  });

  it("verifies and asserts anti-serialization interlock", () => {
    const singlePass = verifyAntiSerializationInterlock(1, 1);
    expect(singlePass.passed).toBe(true);

    const multiPass = verifyAntiSerializationInterlock(3, 3);
    expect(multiPass.passed).toBe(true);

    const blocked = verifyAntiSerializationInterlock(3, 1, ["t1", "t2", "t3"]);
    expect(blocked.passed).toBe(false);
    expect(blocked.violation?.code).toBe(FALSE_SERIALIZATION_DEFECT);

    expect(() => assertAntiSerializationInterlock(3, 1, ["t1", "t2", "t3"])).toThrow();
    expect(() => assertAntiSerializationInterlock(2, 2, ["t1", "t2"])).not.toThrow();
  });
});

describe("Wave Partitioner & Artificial Serialization Detection", () => {
  it("detects artificial serialization on disjoint write scopes", () => {
    const tasks = [
      { taskId: "task-1", writeScope: ["src/module-a.ts"], dependencies: [] },
      { taskId: "task-2", writeScope: ["src/module-b.ts"], dependencies: ["task-1"] },
    ];
    const warnings = detectArtificialSerialization(tasks);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe(ARTIFICIAL_SERIALIZATION_WARNING);
    expect(warnings[0]?.blockedTask).toBe("task-2");
    expect(warnings[0]?.dependencyTask).toBe("task-1");
    expect(warnings[0]?.dataflowJustified).toBe(false);
  });

  it("partitions dynamic lanes bounding to optimal lanes", () => {
    const tasks = [
      { taskId: "t1", writeScope: ["src/a.ts"], dependencies: [] },
      { taskId: "t2", writeScope: ["src/b.ts"], dependencies: [] },
      { taskId: "t3", writeScope: ["src/c.ts"], dependencies: [] },
    ];
    const result = partitionDynamicLanes(tasks, 2);
    expect(result.optimalLanes).toBeLessThanOrEqual(2);
    expect(result.lanes).toHaveLength(3);
  });

  it("partitions wave coordinators by domain and lane count", () => {
    const tasks = [
      { id: "t1", write_scope: ["src/ui/a.tsx"] },
      { id: "t2", write_scope: ["src/ui/b.tsx"] },
      { id: "t3", write_scope: ["src/cli/c.ts"] },
      { id: "t4", write_scope: ["src/db/d.sql"] },
      { id: "t5", write_scope: ["src/engine/e.ts"] },
      { id: "t6", write_scope: ["src/engine/f.ts"] },
    ];
    const result = partitionWaveCoordinators(tasks, { maxLanesPerCoordinator: 3, waveIndex: 2 });
    expect(result.isMultiCoordinator).toBe(true);
    expect(result.coordinatorCount).toBe(2);
    expect(result.waveIndex).toBe(2);
  });

  it("handles empty task sets in wave coordinator partitioning", () => {
    const result = partitionWaveCoordinators([]);
    expect(result.coordinatorCount).toBe(0);
    expect(result.isMultiCoordinator).toBe(false);
  });

  it("decouples disjoint tasks and prunes artificial dependencies in graphs", () => {
    const graph = {
      nodes: [
        { id: "task-1", type: "task", write_scope: ["src/a.ts"], effort: 5, status: "proposed" },
        { id: "task-2", type: "task", write_scope: ["src/b.ts"], effort: 5, status: "proposed" },
      ],
      edges: [{ source: "task-2", target: "task-1", type: "depends_on" }],
    };
    const result = decoupleDisjointTasks(graph);
    expect(result.decoupledEdges).toHaveLength(1);
    expect(result.decoupledEdges[0]?.source).toBe("task-2");
    expect(result.decoupledEdges[0]?.target).toBe("task-1");

    const updatedNodes = result.graph.nodes as { id: string; status: string }[];
    const t2 = updatedNodes.find((n) => n.id === "task-2");
    expect(t2?.status).toBe("ready");
  });

  it("preserves justified dependencies when requested", () => {
    const graph = {
      nodes: [
        { id: "task-1", type: "task", write_scope: ["src/a.ts"] },
        {
          id: "task-2",
          type: "task",
          write_scope: ["src/b.ts"],
          dep_reasons: { "task-1": "Data contract input" },
        },
      ],
      edges: [
        { source: "task-2", target: "task-1", type: "depends_on", reason: "Data contract input" },
      ],
    };
    const result = decoupleDisjointTasks(graph, { preserveJustified: true });
    expect(result.decoupledEdges).toHaveLength(0);
    expect(result.warnings[0]?.dataflowJustified).toBe(true);
  });

  it("handles invalid graph inputs gracefully", () => {
    const result = decoupleDisjointTasks(null);
    expect(result.decoupledEdges).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});
