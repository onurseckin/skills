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

  test("flags warning with dataflowJustified=true when justification is provided in map", () => {
    const tasks = [
      { taskId: "task-a", writeScope: ["src/a.ts"], dependencies: [] },
      { taskId: "task-b", writeScope: ["src/b.ts"], dependencies: ["task-a"] },
    ];
    const justifications = new Map([["task-b->task-a", "Consumes generated schema from task-a"]]);

    const warnings = detectArtificialSerialization(tasks, justifications);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.dataflowJustified).toBe(true);
    expect(warnings[0]!.message).toContain(
      "despite declared justification: Consumes generated schema from task-a",
    );
  });

  test("emits no warnings when write scopes overlap exactly", () => {
    const exactOverlap = [
      { taskId: "task-a", writeScope: ["src/shared.ts"], dependencies: [] },
      { taskId: "task-b", writeScope: ["src/shared.ts"], dependencies: ["task-a"] },
    ];
    expect(detectArtificialSerialization(exactOverlap)).toHaveLength(0);
  });

  test("emits no warnings when write scopes have parent-child directory overlap", () => {
    const parentChildOverlap = [
      { taskId: "task-parent", writeScope: ["src/module"], dependencies: [] },
      {
        taskId: "task-child",
        writeScope: ["src/module/sub/feature.ts"],
        dependencies: ["task-parent"],
      },
    ];
    expect(detectArtificialSerialization(parentChildOverlap)).toHaveLength(0);
  });

  test("flags sibling paths with shared string prefix as disjoint", () => {
    const siblingTasks = [
      { taskId: "task-1", writeScope: ["src/feature-a.ts"], dependencies: [] },
      { taskId: "task-2", writeScope: ["src/feature-ab.ts"], dependencies: ["task-1"] },
    ];
    const warnings = detectArtificialSerialization(siblingTasks);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.blockedTask).toBe("task-2");
  });

  test("handles empty write scopes as disjoint", () => {
    const emptyScopeTasks = [
      { taskId: "task-1", writeScope: [], dependencies: [] },
      { taskId: "task-2", writeScope: ["src/a.ts"], dependencies: ["task-1"] },
    ];
    const warnings = detectArtificialSerialization(emptyScopeTasks);
    expect(warnings).toHaveLength(1);
  });
});

describe("parallel-decoupler: computeWorkSpanMetrics & Brent Concurrency (P = W/S > 1)", () => {
  test("calculates metrics for empty graph", () => {
    const metrics = computeWorkSpanMetrics([], new Map());
    expect(metrics.totalWork).toBe(0);
    expect(metrics.criticalSpan).toBe(0);
    expect(metrics.parallelismFactor).toBe(0);
    expect(metrics.optimalLanes).toBe(1);
    expect(metrics.maxSupportedLanes).toBe(40);
    expect(metrics.efficiency).toBe(0);
  });

  test("calculates metrics for linear sequential chain where P = W/S = 1", () => {
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
    expect(metrics.efficiency).toBe(1);
  });

  test("calculates metrics for wide flat parallel DAG where P = W/S = 40 >> 1", () => {
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
    expect(metrics.efficiency).toBe(1);
  });

  test("calculates diamond DAG parallelism with unbalanced branches", () => {
    const tasks = [
      { id: "root", effort: 2 },
      { id: "branch-a", effort: 8 },
      { id: "branch-b", effort: 4 },
      { id: "branch-c", effort: 4 },
      { id: "branch-d", effort: 2 },
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
    expect(metrics.totalWork).toBe(22);
    expect(metrics.criticalSpan).toBe(12); // root(2) + max branch-a(8) + sink(2)
    // P = 22 / 12 = 1.83
    expect(metrics.parallelismFactor).toBeCloseTo(1.83, 2);
    expect(metrics.optimalLanes).toBe(2);
    expect(metrics.efficiency).toBeCloseTo(0.92, 2);
  });

  test("calculates multi-stage pipeline fan-out with high Brent concurrency", () => {
    // Stage 1: 5 tasks (effort 1)
    // Stage 2: 20 tasks (effort 2)
    // Stage 3: 5 tasks (effort 1)
    const stage1 = Array.from({ length: 5 }, (_, i) => ({ id: `s1-${i + 1}`, effort: 1 }));
    const stage2 = Array.from({ length: 20 }, (_, i) => ({ id: `s2-${i + 1}`, effort: 2 }));
    const stage3 = Array.from({ length: 5 }, (_, i) => ({ id: `s3-${i + 1}`, effort: 1 }));

    const tasks = [...stage1, ...stage2, ...stage3];
    const dependencies = new Map<string, Set<string>>();

    for (const t of stage1) dependencies.set(t.id, new Set());
    for (const t of stage2) dependencies.set(t.id, new Set(stage1.map((s) => s.id)));
    for (const t of stage3) dependencies.set(t.id, new Set(stage2.map((s) => s.id)));

    const metrics = computeWorkSpanMetrics(tasks, dependencies, 40);
    expect(metrics.totalWork).toBe(5 * 1 + 20 * 2 + 5 * 1); // 5 + 40 + 5 = 50
    expect(metrics.criticalSpan).toBe(1 + 2 + 1); // 4
    expect(metrics.parallelismFactor).toBe(12.5); // 50 / 4 = 12.5
    expect(metrics.optimalLanes).toBe(13); // ceil(12.5) = 13
    expect(metrics.efficiency).toBeCloseTo(0.96, 2);
  });

  test("clamps optimal lanes when parallelism factor exceeds maxLanes", () => {
    const tasks = Array.from({ length: 50 }, (_, i) => ({ id: `t-${i + 1}`, effort: 1 }));
    const dependencies = new Map(tasks.map((t) => [t.id, new Set<string>()]));

    const metrics = computeWorkSpanMetrics(tasks, dependencies, 8);
    expect(metrics.totalWork).toBe(50);
    expect(metrics.criticalSpan).toBe(1);
    expect(metrics.parallelismFactor).toBe(50);
    expect(metrics.optimalLanes).toBe(8);
    expect(metrics.maxSupportedLanes).toBe(8);
  });

  test("handles missing, 0, or negative effort by falling back to 1", () => {
    const tasks = [{ id: "t1", effort: 0 }, { id: "t2", effort: -5 }, { id: "t3" }];
    const dependencies = new Map([
      ["t1", new Set<string>()],
      ["t2", new Set<string>()],
      ["t3", new Set<string>()],
    ]);

    const metrics = computeWorkSpanMetrics(tasks, dependencies, 40);
    expect(metrics.totalWork).toBe(3);
    expect(metrics.criticalSpan).toBe(1);
    expect(metrics.parallelismFactor).toBe(3);
  });

  test("handles cyclic or disconnected graph gracefully without infinite loops", () => {
    const tasks = [
      { id: "cycle-1", effort: 2 },
      { id: "cycle-2", effort: 3 },
      { id: "iso-1", effort: 4 },
    ];
    const dependencies = new Map([
      ["cycle-1", new Set(["cycle-2"])],
      ["cycle-2", new Set(["cycle-1"])],
      ["iso-1", new Set<string>()],
    ]);

    const metrics = computeWorkSpanMetrics(tasks, dependencies, 40);
    expect(metrics.totalWork).toBe(9);
    expect(metrics.criticalSpan).toBeGreaterThan(0);
  });
});

describe("parallel-decoupler: partitionDynamicLanes", () => {
  test("partitions tasks using inline dependencies and default options", () => {
    const tasks = [
      { taskId: "t1", writeScope: ["src/a.ts"], effort: 2, dependencies: [] },
      { taskId: "t2", writeScope: ["src/b.ts"], effort: 2, dependencies: [] },
      { taskId: "t3", writeScope: ["src/c.ts"], effort: 2, dependencies: ["t1", "t2"] },
    ];

    const result = partitionDynamicLanes(tasks, 10);
    expect(result.lanes).toHaveLength(3);
    expect(result.waves).toHaveLength(2);
    expect(result.metrics.parallelismFactor).toBe(1.5);
    expect(result.optimalLanes).toBe(2);

    const wave0 = result.lanes.filter((l) => l.waveIndex === 0);
    const wave1 = result.lanes.filter((l) => l.waveIndex === 1);
    expect(wave0).toHaveLength(2);
    expect(wave1).toHaveLength(1);
    expect(wave0.map((l) => l.laneIndex)).toEqual([0, 1]);
    expect(wave1[0]!.laneIndex).toBe(0);
  });

  test("partitions tasks using explicit dependency map", () => {
    const tasks = [
      { id: "x1", write_scope: ["src/x1.ts"], effort: 1 },
      { id: "x2", write_scope: ["src/x2.ts"], effort: 1 },
      { id: "x3", write_scope: ["src/x3.ts"], effort: 1 },
    ];
    const deps = new Map([
      ["x1", new Set<string>()],
      ["x2", new Set<string>()],
      ["x3", new Set<string>()],
    ]);

    const result = partitionDynamicLanes(tasks, deps, 40);
    expect(result.lanes).toHaveLength(3);
    expect(result.waves).toHaveLength(1);
    expect(result.optimalLanes).toBe(3);
    expect(result.lanes.map((l) => l.laneIndex)).toEqual([0, 1, 2]);
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

  test("allocates multi-wave dependencies across lanes with modulo wrapping", () => {
    const tasks = [
      { taskId: "t1", writeScope: ["src/a"], dependencies: [] },
      { taskId: "t2", writeScope: ["src/b"], dependencies: [] },
      { taskId: "t3", writeScope: ["src/c"], dependencies: [] },
      { taskId: "t4", writeScope: ["src/d"], dependencies: ["t1", "t2", "t3"] },
    ];
    const dependencies = new Map([
      ["t1", new Set<string>()],
      ["t2", new Set<string>()],
      ["t3", new Set<string>()],
      ["t4", new Set(["t1", "t2", "t3"])],
    ]);

    const lanes = allocateParallelLanes(tasks, dependencies, 2);
    expect(lanes).toHaveLength(4);
    const wave0Lanes = lanes.filter((l) => l.waveIndex === 0);
    const wave1Lanes = lanes.filter((l) => l.waveIndex === 1);
    expect(wave0Lanes).toHaveLength(3);
    expect(wave1Lanes).toHaveLength(1);
    expect(wave0Lanes.map((l) => l.laneIndex)).toEqual([0, 1, 0]);
    expect(wave1Lanes[0]!.taskId).toBe("t4");
    expect(wave1Lanes[0]!.laneIndex).toBe(0);
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

  test("preserves dependency edges with declared dataflow justifications when preserveJustified is true", () => {
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

  test("removes dataflow justified edges when preserveJustified is false", () => {
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
        },
      ],
      edges: [
        {
          source: "task-consume",
          target: "task-gen",
          type: "depends_on",
          justification: "Non-critical ordering",
        },
      ],
    };

    const result = decoupleDisjointTasks(graph, { preserveJustified: false });
    expect(result.decoupledEdges).toHaveLength(1);
    expect(result.waves).toHaveLength(1);
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
    const resultNull = decoupleDisjointTasks(null);
    expect(resultNull.decoupledEdges).toHaveLength(0);
    expect(resultNull.warnings).toHaveLength(0);
    expect(resultNull.metrics.totalWork).toBe(0);
    expect(resultNull.waves).toHaveLength(0);

    const resultString = decoupleDisjointTasks("invalid-input");
    expect(resultString.decoupledEdges).toHaveLength(0);
    expect(resultString.metrics.totalWork).toBe(0);
  });

  test("decouples complex mixed DAG separating disjoint chains while maintaining true blockers", () => {
    // 3 independent pipelines:
    // Pipeline A: a1 -> a2 (disjoint scopes) -> artificial edge severed
    // Pipeline B: b1 -> b2 (overlapping scopes) -> true edge preserved
    // Pipeline C: c1 -> c2 (justified edge) -> preserved under default options
    const graph = {
      schema: "harness.graph",
      version: 1,
      revision: 1,
      nodes: [
        { id: "a1", type: "task", write_scope: ["src/a1.ts"], effort: 2, status: "ready" },
        { id: "a2", type: "task", write_scope: ["src/a2.ts"], effort: 2, status: "proposed" },
        { id: "b1", type: "task", write_scope: ["src/shared/b.ts"], effort: 3, status: "ready" },
        { id: "b2", type: "task", write_scope: ["src/shared/b.ts"], effort: 3, status: "proposed" },
        { id: "c1", type: "task", write_scope: ["src/c1.ts"], effort: 1, status: "ready" },
        {
          id: "c2",
          type: "task",
          write_scope: ["src/c2.ts"],
          effort: 1,
          status: "proposed",
          depReasons: { c1: "Needs c1 output file" },
        },
      ],
      edges: [
        { source: "a2", target: "a1", type: "depends_on" }, // Disjoint artificial -> should decouple
        { source: "b2", target: "b1", type: "depends_on" }, // Overlapping true -> preserve
        { source: "c2", target: "c1", type: "depends_on", justification: "Needs c1 output file" }, // Justified -> preserve
      ],
    };

    const result = decoupleDisjointTasks(graph);
    expect(result.decoupledEdges).toHaveLength(1);
    expect(result.decoupledEdges[0]!).toEqual({ source: "a2", target: "a1" });

    const nodes = result.graph.nodes as Record<string, unknown>[];
    const a2Node = nodes.find((n) => n.id === "a2");
    const b2Node = nodes.find((n) => n.id === "b2");
    const c2Node = nodes.find((n) => n.id === "c2");

    // a2 should be promoted to ready because its only blocker was severed
    expect(a2Node?.status).toBe("ready");
    // b2 and c2 still have upstream blockers so they remain proposed
    expect(b2Node?.status).toBe("proposed");
    expect(c2Node?.status).toBe("proposed");
  });
});
