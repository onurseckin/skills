import { describe, expect, test } from "bun:test";
import {
  ARTIFICIAL_SERIALIZATION_WARNING,
  computeWorkSpanMetrics,
  detectArtificialSerialization,
} from "../../../olt/scripts/src/graph/parallel-decoupler.ts";

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
    expect(metrics.criticalSpan).toBe(12);
    expect(metrics.parallelismFactor).toBeCloseTo(1.83, 2);
    expect(metrics.optimalLanes).toBe(2);
    expect(metrics.efficiency).toBeCloseTo(0.92, 2);
  });

  test("calculates multi-stage pipeline fan-out with high Brent concurrency", () => {
    const stage1 = Array.from({ length: 5 }, (_, i) => ({ id: `s1-${i + 1}`, effort: 1 }));
    const stage2 = Array.from({ length: 20 }, (_, i) => ({ id: `s2-${i + 1}`, effort: 2 }));
    const stage3 = Array.from({ length: 5 }, (_, i) => ({ id: `s3-${i + 1}`, effort: 1 }));

    const tasks = [...stage1, ...stage2, ...stage3];
    const dependencies = new Map<string, Set<string>>();

    for (const t of stage1) dependencies.set(t.id, new Set());
    for (const t of stage2) dependencies.set(t.id, new Set(stage1.map((s) => s.id)));
    for (const t of stage3) dependencies.set(t.id, new Set(stage2.map((s) => s.id)));

    const metrics = computeWorkSpanMetrics(tasks, dependencies, 40);
    expect(metrics.totalWork).toBe(50);
    expect(metrics.criticalSpan).toBe(4);
    expect(metrics.parallelismFactor).toBe(12.5);
    expect(metrics.optimalLanes).toBe(13);
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
