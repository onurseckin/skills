import { describe, expect, test } from "bun:test";
import {
  calculateBrentsTheorem,
  computeCriticalPathDrag,
  computeTaskSlack,
  computeWorkSpan,
  type ForensicTaskNode,
} from "../../../olt/scripts/src/graph/dag-forensics.ts";

describe("DAG Forensics: Work-Span Mathematics", () => {
  test("handles empty graph gracefully", () => {
    const tasks: readonly ForensicTaskNode[] = [];
    const deps = new Map<string, ReadonlySet<string>>();
    const metrics = computeWorkSpan(tasks, deps);

    expect(metrics.totalWork).toBe(0);
    expect(metrics.criticalSpan).toBe(0);
    expect(metrics.parallelismFactor).toBe(0);
    expect(metrics.optimalLanes).toBe(1);
    expect(metrics.criticalPath).toEqual([]);
  });

  test("computes single-node metrics", () => {
    const tasks: readonly ForensicTaskNode[] = [{ id: "t1", effort: 5 }];
    const deps = new Map<string, ReadonlySet<string>>([["t1", new Set<string>()]]);
    const metrics = computeWorkSpan(tasks, deps);

    expect(metrics.totalWork).toBe(5);
    expect(metrics.criticalSpan).toBe(5);
    expect(metrics.parallelismFactor).toBe(1);
    expect(metrics.optimalLanes).toBe(1);
    expect(metrics.criticalPath).toEqual(["t1"]);
  });

  test("computes linear chain metrics with work equal to span", () => {
    const tasks: readonly ForensicTaskNode[] = [
      { id: "a", effort: 3 },
      { id: "b", effort: 4 },
      { id: "c", effort: 5 },
    ];
    const deps = new Map<string, ReadonlySet<string>>([
      ["a", new Set<string>()],
      ["b", new Set(["a"])],
      ["c", new Set(["b"])],
    ]);
    const metrics = computeWorkSpan(tasks, deps);

    expect(metrics.totalWork).toBe(12);
    expect(metrics.criticalSpan).toBe(12);
    expect(metrics.parallelismFactor).toBe(1);
    expect(metrics.optimalLanes).toBe(1);
    expect(metrics.criticalPath).toEqual(["a", "b", "c"]);
  });

  test("computes purely parallel tasks with max parallelism", () => {
    const tasks: readonly ForensicTaskNode[] = [
      { id: "p1", effort: 4 },
      { id: "p2", effort: 4 },
      { id: "p3", effort: 4 },
      { id: "p4", effort: 4 },
    ];
    const deps = new Map<string, ReadonlySet<string>>([
      ["p1", new Set<string>()],
      ["p2", new Set<string>()],
      ["p3", new Set<string>()],
      ["p4", new Set<string>()],
    ]);
    const metrics = computeWorkSpan(tasks, deps);

    expect(metrics.totalWork).toBe(16);
    expect(metrics.criticalSpan).toBe(4);
    expect(metrics.parallelismFactor).toBe(4);
    expect(metrics.optimalLanes).toBe(4);
  });

  test("identifies critical path in asymmetric diamond graph", () => {
    const tasks: readonly ForensicTaskNode[] = [
      { id: "root", effort: 2 },
      { id: "branch-a", effort: 8 },
      { id: "branch-b", effort: 3 },
      { id: "branch-c", effort: 4 },
      { id: "sink", effort: 2 },
    ];
    const deps = new Map<string, ReadonlySet<string>>([
      ["root", new Set<string>()],
      ["branch-a", new Set(["root"])],
      ["branch-b", new Set(["root"])],
      ["branch-c", new Set(["root"])],
      ["sink", new Set(["branch-a", "branch-b", "branch-c"])],
    ]);
    const metrics = computeWorkSpan(tasks, deps);

    expect(metrics.totalWork).toBe(19);
    expect(metrics.criticalSpan).toBe(12);
    expect(metrics.parallelismFactor).toBe(1.58);
    expect(metrics.optimalLanes).toBe(2);
    expect(metrics.criticalPath).toEqual(["root", "branch-a", "sink"]);
  });
});

describe("DAG Forensics: Brent Bounds & Speedup Theorems", () => {
  test("evaluates single-processor sequential baseline", () => {
    const brent = calculateBrentsTheorem(60, 20, 1);
    expect(brent.processorCount).toBe(1);
    expect(brent.estimatedTime).toBe(60);
    expect(brent.theoreticalSpeedup).toBe(1);
    expect(brent.theoreticalEfficiency).toBe(1);
  });

  test("evaluates multiprocessor bounded execution time", () => {
    const brent = calculateBrentsTheorem(60, 20, 3);
    expect(brent.processorCount).toBe(3);
    expect(brent.lowerBound).toBe(20);
    expect(brent.upperBound).toBe(33);
    expect(brent.estimatedTime).toBeGreaterThanOrEqual(20);
    expect(brent.estimatedTime).toBeLessThanOrEqual(34);
    expect(brent.theoreticalSpeedup).toBeGreaterThan(1);
  });

  test("evaluates infinite processors asymptotic convergence to critical span", () => {
    const brent = calculateBrentsTheorem(100, 15, 100);
    expect(brent.lowerBound).toBe(15);
    expect(brent.upperBound).toBe(15);
    expect(brent.estimatedTime).toBeCloseTo(15, 0);
  });

  test("handles zero work and span correctly", () => {
    const brent = calculateBrentsTheorem(0, 0, 4);
    expect(brent.lowerBound).toBe(1);
    expect(brent.theoreticalSpeedup).toBe(0);
    expect(brent.theoreticalEfficiency).toBe(0);
  });
});

describe("DAG Forensics: Critical Path Drag & Slack Analysis", () => {
  test("computes critical path drag and non-critical zero drag", () => {
    const tasks: readonly ForensicTaskNode[] = [
      { id: "root", effort: 4 },
      { id: "long-branch", effort: 10 },
      { id: "short-branch", effort: 2 },
      { id: "sink", effort: 4 },
    ];
    const deps = new Map<string, ReadonlySet<string>>([
      ["root", new Set<string>()],
      ["long-branch", new Set(["root"])],
      ["short-branch", new Set(["root"])],
      ["sink", new Set(["long-branch", "short-branch"])],
    ]);

    const drags = computeCriticalPathDrag(tasks, deps);
    const rootDrag = drags.find((d) => d.taskId === "root");
    const longDrag = drags.find((d) => d.taskId === "long-branch");
    const shortDrag = drags.find((d) => d.taskId === "short-branch");
    const sinkDrag = drags.find((d) => d.taskId === "sink");

    expect(rootDrag?.isCritical).toBe(true);
    expect(rootDrag?.drag).toBe(4);

    expect(longDrag?.isCritical).toBe(true);
    expect(longDrag?.drag).toBe(8);

    expect(shortDrag?.isCritical).toBe(false);
    expect(shortDrag?.drag).toBe(0);

    expect(sinkDrag?.isCritical).toBe(true);
    expect(sinkDrag?.drag).toBe(4);
  });

  test("computes exact task slack and free slack metrics", () => {
    const tasks: readonly ForensicTaskNode[] = [
      { id: "root", effort: 2 },
      { id: "fast", effort: 3 },
      { id: "slow", effort: 7 },
      { id: "sink", effort: 2 },
    ];
    const deps = new Map<string, ReadonlySet<string>>([
      ["root", new Set<string>()],
      ["fast", new Set(["root"])],
      ["slow", new Set(["root"])],
      ["sink", new Set(["fast", "slow"])],
    ]);

    const slacks = computeTaskSlack(tasks, deps);
    const fastSlack = slacks.get("fast");
    const slowSlack = slacks.get("slow");

    expect(fastSlack?.isCritical).toBe(false);
    expect(fastSlack?.totalSlack).toBe(4);
    expect(fastSlack?.freeSlack).toBe(4);

    expect(slowSlack?.isCritical).toBe(true);
    expect(slowSlack?.totalSlack).toBe(0);
    expect(slowSlack?.freeSlack).toBe(0);
  });
});
