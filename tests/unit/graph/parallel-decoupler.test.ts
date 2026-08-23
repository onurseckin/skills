import { describe, expect, test } from "bun:test";
import {
  allocateParallelLanes,
  ARTIFICIAL_SERIALIZATION_WARNING,
  computeWorkSpanMetrics,
  decoupleDisjointTasks,
  detectArtificialSerialization,
  partitionDynamicLanes,
} from "../../../orchestrating-long-tasks/scripts/src/graph/parallel-decoupler.ts";

describe("parallel-decoupler: detectArtificialSerialization", () => {
  test("flags artificial serialization for disjoint tasks without dataflow justification", () => {
    const tasks = [
      { taskId: "task-a", writeScope: ["src/a.ts"], dependencies: [] },
      { taskId: "task-b", writeScope: ["src/b.ts"], dependencies: ["task-a"] },
    ];

    const warnings = detectArtificialSerialization(tasks);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.code).toBe(ARTIFICIAL_SERIALIZATION_WARNING);
    expect(warnings[0]!.blockedTask).toBe("task-b");
    expect(warnings[0]!.dependencyTask).toBe("task-a");
    expect(warnings[0]!.dataflowJustified).toBe(false);
    expect(warnings[0]!.sourceScope).toEqual(["src/b.ts"]);
    expect(warnings[0]!.targetScope).toEqual(["src/a.ts"]);
  });

  test("flags warning with dataflowJustified=true when justification is provided", () => {
    const tasks = [
      { taskId: "task-a", writeScope: ["src/a.ts"], dependencies: [] },
      { taskId: "task-b", writeScope: ["src/b.ts"], dependencies: ["task-a"] },
    ];
    const justifications = new Map([
      ["task-b->task-a", "Consumes generated artifacts from task-a"],
    ]);

    const warnings = detectArtificialSerialization(tasks, justifications);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.dataflowJustified).toBe(true);
    expect(warnings[0]!.message).toContain("despite declared justification");
  });

  test("emits no warnings when scopes overlap (exact match or parent-child)", () => {
    const exactOverlap = [
      { taskId: "task-a", writeScope: ["src/shared.ts"], dependencies: [] },
      { taskId: "task-b", writeScope: ["src/shared.ts"], dependencies: ["task-a"] },
    ];
    expect(detectArtificialSerialization(exactOverlap)).toHaveLength(0);

    const parentChildOverlap = [
      { taskId: "task-parent", writeScope: ["src/module"], dependencies: [] },
      { taskId: "task-child", writeScope: ["src/module/sub"], dependencies: ["task-parent"] },
    ];
    expect(detectArtificialSerialization(parentChildOverlap)).toHaveLength(0);
  });
});

describe("parallel-decoupler: computeWorkSpanMetrics", () => {
  test("calculates metrics for empty graph", () => {
    const metrics = computeWorkSpanMetrics([], new Map());
    expect(metrics.totalWork).toBe(0);
    expect(metrics.criticalSpan).toBe(0);
    expect(metrics.parallelismFactor).toBe(0);
    expect(metrics.optimalLanes).toBe(1);
    expect(metrics.maxSupportedLanes).toBe(40);
  });

  test("calculates metrics for linear sequential chain", () => {
    const tasks = [
      { id: "task-1", effort: 2 },
      { id: "task-2", effort: 3 },
      { id: "task-3", effort: 5 },
    ];
    const dependencies = new Map([
      ["task-1", new Set<string>()],
      ["task-2", new Set(["task-1"])],
      ["task-3", new Set(["task-2"])],
    ]);

    const metrics = computeWorkSpanMetrics(tasks, dependencies, 40);
    expect(metrics.totalWork).toBe(10);
    expect(metrics.criticalSpan).toBe(10);
    expect(metrics.parallelismFactor).toBe(1);
    expect(metrics.optimalLanes).toBe(1);
  });

  test("calculates metrics for perfectly parallel tasks", () => {
    const tasks = Array.from({ length: 40 }, (_, idx) => ({
      id: `task-${idx + 1}`,
      effort: 2,
    }));
    const dependencies = new Map(tasks.map((t) => [t.id, new Set<string>()]));

    const metrics = computeWorkSpanMetrics(tasks, dependencies, 40);
    expect(metrics.totalWork).toBe(80);
    expect(metrics.criticalSpan).toBe(2);
    expect(metrics.parallelismFactor).toBe(40);
    expect(metrics.optimalLanes).toBe(40);
  });

  test("calculates diamond DAG parallelism correctly", () => {
    const tasks = [
      { id: "root", effort: 2 },
      { id: "branch-a", effort: 4 },
      { id: "branch-b", effort: 4 },
      { id: "branch-c", effort: 4 },
      { id: "branch-d", effort: 4 },
      { id: "sink", effort: 2 },
    ];
    const dependencies = new Map([
      ["root", new Set<string>()],
      ["branch-a", new Set(["root"])],
      ["branch-b", new Set(["root"])],
      ["branch-c", new Set(["root"])],
      ["branch-d", new Set(["root"])],
      ["sink", new Set(["branch-a", "branch-b", "branch-c", "branch-d"])],
    ]);

    const metrics = computeWorkSpanMetrics(tasks, dependencies, 40);
    expect(metrics.totalWork).toBe(20);
    expect(metrics.criticalSpan).toBe(8); // root(2) + max branch(4) + sink(2)
    expect(metrics.parallelismFactor).toBe(2.5);
    expect(metrics.optimalLanes).toBe(3);
  });
});

describe("parallel-decoupler: allocateParallelLanes", () => {
  test("allocates 40 tasks into 40 distinct concurrent lanes in single wave", () => {
    const tasks = Array.from({ length: 40 }, (_, i) => ({
      taskId: `task-${i + 1}`,
      writeScope: [`src/module-${i + 1}.ts`],
      dependencies: [],
    }));
    const dependencies = new Map(tasks.map((t) => [t.taskId, new Set<string>()]));

    const lanes = allocateParallelLanes(tasks, dependencies, 40);
    expect(lanes).toHaveLength(40);
    const assignedLanes = new Set(lanes.map((l) => l.laneIndex));
    expect(assignedLanes.size).toBe(40);
    for (let i = 0; i < 40; i++) {
      expect(assignedLanes.has(i)).toBe(true);
    }
  });

  test("allocates multi-wave dependencies across lanes", () => {
    const tasks = [
      { taskId: "t1", writeScope: ["src/a"], dependencies: [] },
      { taskId: "t2", writeScope: ["src/b"], dependencies: [] },
      { taskId: "t3", writeScope: ["src/c"], dependencies: ["t1", "t2"] },
    ];
    const dependencies = new Map([
      ["t1", new Set<string>()],
      ["t2", new Set<string>()],
      ["t3", new Set(["t1", "t2"])],
    ]);

    const lanes = allocateParallelLanes(tasks, dependencies, 40);
    expect(lanes).toHaveLength(3);
    const wave0Lanes = lanes.filter((l) => l.waveIndex === 0);
    const wave1Lanes = lanes.filter((l) => l.waveIndex === 1);
    expect(wave0Lanes).toHaveLength(2);
    expect(wave1Lanes).toHaveLength(1);
    expect(wave1Lanes[0]!.taskId).toBe("t3");
  });
});

describe("parallel-decoupler: decoupleDisjointTasks", () => {
  test("decouples artificial linear chain into 40 parallel lanes and updates statuses", () => {
    const nodes = Array.from({ length: 40 }, (_, i) => ({
      id: `task-${i + 1}`,
      type: "task",
      label: `Task ${i + 1}`,
      write_scope: [`src/lane-${i + 1}.ts`],
      effort: 1,
      status: i === 0 ? "ready" : "proposed",
    }));

    // Construct false artificial linear chain: task-2 depends on task-1, task-3 depends on task-2...
    const edges = Array.from({ length: 39 }, (_, i) => ({
      source: `task-${i + 2}`,
      target: `task-${i + 1}`,
      type: "depends_on",
    }));

    const graph = {
      schema: "harness.graph",
      version: 1,
      revision: 1,
      nodes,
      edges,
    };

    const result = decoupleDisjointTasks(graph, { maxLanes: 40 });

    expect(result.decoupledEdges).toHaveLength(39);
    expect(result.warnings).toHaveLength(39);
    expect(result.waves).toHaveLength(1);
    expect(result.waves[0]!.tasks).toHaveLength(40);
    expect(result.metrics.parallelismFactor).toBe(40);
    expect(result.metrics.optimalLanes).toBe(40);
    expect(result.lanes).toHaveLength(40);

    // Check that proposed tasks were promoted to ready
    const resultNodes = result.graph.nodes as Record<string, unknown>[];
    for (const node of resultNodes) {
      if (node.type === "task") {
        expect(node.status).toBe("ready");
      }
    }
  });

  test("preserves dependency edges with declared dataflow justifications", () => {
    const graph = {
      schema: "harness.graph",
      version: 1,
      revision: 1,
      nodes: [
        {
          id: "task-gen",
          type: "task",
          write_scope: ["src/gen.ts"],
          effort: 2,
          status: "ready",
        },
        {
          id: "task-consume",
          type: "task",
          write_scope: ["src/consumer.ts"],
          effort: 3,
          status: "proposed",
          depReasons: {
            "task-gen": "Reads schema generated by task-gen",
          },
        },
      ],
      edges: [
        {
          source: "task-consume",
          target: "task-gen",
          type: "depends_on",
          dataflow_justification: "Reads schema generated by task-gen",
        },
      ],
    };

    const result = decoupleDisjointTasks(graph, { preserveJustified: true });
    expect(result.decoupledEdges).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.dataflowJustified).toBe(true);
    expect(result.waves).toHaveLength(2);
    expect(result.metrics.criticalSpan).toBe(5);
  });

  test("preserves dependency edges with overlapping write scopes", () => {
    const graph = {
      schema: "harness.graph",
      version: 1,
      revision: 1,
      nodes: [
        {
          id: "task-1",
          type: "task",
          write_scope: ["src/core"],
          status: "ready",
        },
        {
          id: "task-2",
          type: "task",
          write_scope: ["src/core/utils.ts"],
          status: "proposed",
        },
      ],
      edges: [
        {
          source: "task-2",
          target: "task-1",
          type: "depends_on",
        },
      ],
    };

    const result = decoupleDisjointTasks(graph);
    expect(result.decoupledEdges).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.waves).toHaveLength(2);
  });

  test("handles empty or invalid graph object safely", () => {
    const result = decoupleDisjointTasks(null);
    expect(result.decoupledEdges).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.metrics.totalWork).toBe(0);
    expect(result.waves).toHaveLength(0);
  });

  test("partitionDynamicLanes partitions wave tasks according to Brent bounds", () => {
    const tasks = [
      { id: "t1", effort: 2 },
      { id: "t2", effort: 3 },
    ];
    const result = partitionDynamicLanes(tasks, 2);
    expect(result.lanes).toBeDefined();
    expect(result.lanes.length).toBeGreaterThan(0);
  });
});
