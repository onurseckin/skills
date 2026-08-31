import { describe, expect, test } from "bun:test";
import {
  allocateParallelLanes,
  calculateBrentsTheorem,
  computeTopologicalWaves,
  computeWorkSpan,
  detectFanOutBottlenecks,
  type ForensicTaskNode,
} from "../../../../olt/scripts/src/graph/forensics/index.ts";

describe("DAG Forensics: Work-Span Metrics Calculation", () => {
  test("computes baseline metrics for empty and single node topologies", () => {
    const emptyMetrics = computeWorkSpan([], new Map());
    expect(emptyMetrics.totalWork).toBe(0);
    expect(emptyMetrics.criticalSpan).toBe(0);
    expect(emptyMetrics.parallelismFactor).toBe(0);
    expect(emptyMetrics.optimalLanes).toBe(1);
    expect(emptyMetrics.criticalPath).toEqual([]);

    const singleTask: readonly ForensicTaskNode[] = [{ id: "task-root", effort: 8 }];
    const singleDeps = new Map<string, ReadonlySet<string>>([["task-root", new Set()]]);
    const singleMetrics = computeWorkSpan(singleTask, singleDeps);

    expect(singleMetrics.totalWork).toBe(8);
    expect(singleMetrics.criticalSpan).toBe(8);
    expect(singleMetrics.parallelismFactor).toBe(1);
    expect(singleMetrics.optimalLanes).toBe(1);
    expect(singleMetrics.criticalPath).toEqual(["task-root"]);
  });

  test("computes linear and wide parallel topologies with exact parallelism factors", () => {
    const linearTasks: readonly ForensicTaskNode[] = [
      { id: "stage-1", effort: 10 },
      { id: "stage-2", effort: 15 },
      { id: "stage-3", effort: 5 },
    ];
    const linearDeps = new Map<string, ReadonlySet<string>>([
      ["stage-1", new Set()],
      ["stage-2", new Set(["stage-1"])],
      ["stage-3", new Set(["stage-2"])],
    ]);
    const linearMetrics = computeWorkSpan(linearTasks, linearDeps);

    expect(linearMetrics.totalWork).toBe(30);
    expect(linearMetrics.criticalSpan).toBe(30);
    expect(linearMetrics.parallelismFactor).toBe(1);
    expect(linearMetrics.optimalLanes).toBe(1);
    expect(linearMetrics.criticalPath).toEqual(["stage-1", "stage-2", "stage-3"]);

    const wideTasks: readonly ForensicTaskNode[] = [
      { id: "p1", effort: 6 },
      { id: "p2", effort: 6 },
      { id: "p3", effort: 6 },
      { id: "p4", effort: 6 },
      { id: "p5", effort: 6 },
    ];
    const wideDeps = new Map<string, ReadonlySet<string>>([
      ["p1", new Set()],
      ["p2", new Set()],
      ["p3", new Set()],
      ["p4", new Set()],
      ["p5", new Set()],
    ]);
    const wideMetrics = computeWorkSpan(wideTasks, wideDeps);

    expect(wideMetrics.totalWork).toBe(30);
    expect(wideMetrics.criticalSpan).toBe(6);
    expect(wideMetrics.parallelismFactor).toBe(5);
    expect(wideMetrics.optimalLanes).toBe(5);
  });

  test("calculates work-span across complex asymmetric diamond and multi-branch DAGs", () => {
    const complexTasks: readonly ForensicTaskNode[] = [
      { id: "entry", effort: 4 },
      { id: "fast-lane", effort: 3 },
      { id: "heavy-lane-1", effort: 12 },
      { id: "heavy-lane-2", effort: 8 },
      { id: "medium-lane", effort: 7 },
      { id: "exit", effort: 5 },
    ];
    const complexDeps = new Map<string, ReadonlySet<string>>([
      ["entry", new Set()],
      ["fast-lane", new Set(["entry"])],
      ["heavy-lane-1", new Set(["entry"])],
      ["heavy-lane-2", new Set(["heavy-lane-1"])],
      ["medium-lane", new Set(["entry"])],
      ["exit", new Set(["fast-lane", "heavy-lane-2", "medium-lane"])],
    ]);

    const metrics = computeWorkSpan(complexTasks, complexDeps, 10);
    expect(metrics.totalWork).toBe(39);
    expect(metrics.criticalSpan).toBe(29);
    expect(metrics.parallelismFactor).toBe(1.34);
    expect(metrics.optimalLanes).toBe(2);
    expect(metrics.criticalPath).toEqual(["entry", "heavy-lane-1", "heavy-lane-2", "exit"]);
  });

  test("respects maxLanes constraints when calculating optimal lanes", () => {
    const tasks: readonly ForensicTaskNode[] = Array.from({ length: 20 }, (_, i) => ({
      id: `task-${i + 1}`,
      effort: 2,
    }));
    const deps = new Map<string, ReadonlySet<string>>(tasks.map((t) => [t.id, new Set()]));

    const uncapped = computeWorkSpan(tasks, deps, 50);
    expect(uncapped.parallelismFactor).toBe(20);
    expect(uncapped.optimalLanes).toBe(20);

    const capped = computeWorkSpan(tasks, deps, 8);
    expect(capped.optimalLanes).toBe(8);
    expect(capped.maxSupportedLanes).toBe(8);
  });
});

describe("DAG Forensics: Brents Bounds and Speedup Calculations", () => {
  test("calculates exact Brent theorem bounds and limits", () => {
    const totalWork = 100;
    const criticalSpan = 20;

    const singleProc = calculateBrentsTheorem(totalWork, criticalSpan, 1);
    expect(singleProc.processorCount).toBe(1);
    expect(singleProc.lowerBound).toBe(100);
    expect(singleProc.upperBound).toBe(100);
    expect(singleProc.estimatedTime).toBe(100);
    expect(singleProc.theoreticalSpeedup).toBe(1);
    expect(singleProc.theoreticalEfficiency).toBe(1);

    const dualProc = calculateBrentsTheorem(totalWork, criticalSpan, 2);
    expect(dualProc.processorCount).toBe(2);
    expect(dualProc.lowerBound).toBe(50);
    expect(dualProc.upperBound).toBe(60);
    expect(dualProc.estimatedTime).toBe(60);
    expect(dualProc.theoreticalSpeedup).toBe(1.67);
    expect(dualProc.theoreticalEfficiency).toBe(0.83);

    const infiniteProc = calculateBrentsTheorem(totalWork, criticalSpan, 1000);
    expect(infiniteProc.lowerBound).toBe(20);
    expect(infiniteProc.upperBound).toBe(20);
    expect(infiniteProc.estimatedTime).toBe(20);
    expect(infiniteProc.theoreticalSpeedup).toBe(5);
  });

  test("generates standard processor evaluations in computeWorkSpan", () => {
    const tasks: readonly ForensicTaskNode[] = [
      { id: "a", effort: 20 },
      { id: "b1", effort: 30 },
      { id: "b2", effort: 30 },
      { id: "c", effort: 20 },
    ];
    const deps = new Map<string, ReadonlySet<string>>([
      ["a", new Set()],
      ["b1", new Set(["a"])],
      ["b2", new Set(["a"])],
      ["c", new Set(["b1", "b2"])],
    ]);

    const metrics = computeWorkSpan(tasks, deps, 16);
    expect(metrics.brentsBounds.length).toBeGreaterThanOrEqual(4);

    const p1 = metrics.brentsBounds.find((b) => b.processorCount === 1);
    const p2 = metrics.brentsBounds.find((b) => b.processorCount === 2);
    const p16 = metrics.brentsBounds.find((b) => b.processorCount === 16);

    expect(p1?.estimatedTime).toBe(100);
    expect(p2?.estimatedTime).toBe(85);
    expect(p16?.estimatedTime).toBe(71);
  });
});

describe("DAG Forensics: Topological Waves, Bottlenecks, and Lane Allocations", () => {
  test("computes topological waves with correct concurrency levels", () => {
    const tasks: readonly ForensicTaskNode[] = [
      { id: "init", effort: 2, writeScope: ["src/init"] },
      { id: "w1-a", effort: 4, writeScope: ["src/a"] },
      { id: "w1-b", effort: 4, writeScope: ["src/b"] },
      { id: "w2-a", effort: 3, writeScope: ["src/c"] },
    ];
    const deps = new Map<string, ReadonlySet<string>>([
      ["init", new Set()],
      ["w1-a", new Set(["init"])],
      ["w1-b", new Set(["init"])],
      ["w2-a", new Set(["w1-a"])],
    ]);

    const waves = computeTopologicalWaves(tasks, deps);
    expect(waves).toHaveLength(3);
    expect(waves[0]?.waveIndex).toBe(1);
    expect(waves[0]?.taskIds).toEqual(["init"]);
    expect(waves[1]?.waveIndex).toBe(2);
    expect(waves[1]?.taskIds).toEqual(["w1-a", "w1-b"]);
    expect(waves[1]?.maxLaneConcurrency).toBe(2);
    expect(waves[1]?.hasScopeConflicts).toBe(false);
    expect(waves[2]?.waveIndex).toBe(3);
    expect(waves[2]?.taskIds).toEqual(["w2-a"]);
  });

  test("detects fan-out bottlenecks and classifies severity", () => {
    const tasks: readonly ForensicTaskNode[] = [
      { id: "core", effort: 5 },
      { id: "leaf-1", effort: 2 },
      { id: "leaf-2", effort: 3 },
      { id: "leaf-3", effort: 4 },
    ];
    const deps = new Map<string, ReadonlySet<string>>([
      ["core", new Set()],
      ["leaf-1", new Set(["core"])],
      ["leaf-2", new Set(["core"])],
      ["leaf-3", new Set(["core"])],
    ]);

    const bottlenecks = detectFanOutBottlenecks(tasks, deps, 3);
    expect(bottlenecks).toHaveLength(1);
    expect(bottlenecks[0]?.taskId).toBe("core");
    expect(bottlenecks[0]?.fanOutCount).toBe(3);
    expect(bottlenecks[0]?.blockedEffort).toBe(9);
    expect(bottlenecks[0]?.isCritical).toBe(true);
    expect(bottlenecks[0]?.severity).toBe("high");
  });

  test("allocates parallel lanes with wave indices and slack timings", () => {
    const tasks: readonly ForensicTaskNode[] = [
      { id: "root", effort: 2 },
      { id: "sub-1", effort: 3 },
      { id: "sub-2", effort: 3 },
    ];
    const deps = new Map<string, ReadonlySet<string>>([
      ["root", new Set()],
      ["sub-1", new Set(["root"])],
      ["sub-2", new Set(["root"])],
    ]);

    const lanes = allocateParallelLanes(tasks, deps, 2);
    expect(lanes).toHaveLength(3);

    const rootLane = lanes.find((l) => l.taskId === "root");
    expect(rootLane?.waveIndex).toBe(1);
    expect(rootLane?.laneIndex).toBe(0);

    const sub1Lane = lanes.find((l) => l.taskId === "sub-1");
    const sub2Lane = lanes.find((l) => l.taskId === "sub-2");
    expect(sub1Lane?.waveIndex).toBe(2);
    expect(sub2Lane?.waveIndex).toBe(2);
    expect(sub1Lane?.laneIndex).not.toBe(sub2Lane?.laneIndex);
  });
});
