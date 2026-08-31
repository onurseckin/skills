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
      { id: "start", effort: 2 },
      { id: "fast", effort: 1 },
      { id: "slow1", effort: 5 },
      { id: "slow2", effort: 4 },
      { id: "end", effort: 3 },
    ];
    const deps = new Map<string, ReadonlySet<string>>([
      ["start", new Set<string>()],
      ["fast", new Set(["start"])],
      ["slow1", new Set(["start"])],
      ["slow2", new Set(["slow1"])],
      ["end", new Set(["fast", "slow2"])],
    ]);
    const metrics = computeWorkSpan(tasks, deps);

    expect(metrics.totalWork).toBe(15);
    expect(metrics.criticalSpan).toBe(14);
    expect(metrics.parallelismFactor).toBe(1.07);
    expect(metrics.criticalPath).toEqual(["start", "slow1", "slow2", "end"]);
  });
});

describe("DAG Forensics: Brent Bounds & Speedup Theorems", () => {
  test("evaluates single-processor sequential baseline", () => {
    const bound = calculateBrentsTheorem(100, 20, 1);

    expect(bound.processorCount).toBe(1);
    expect(bound.lowerBound).toBe(100);
    expect(bound.upperBound).toBe(100);
    expect(bound.estimatedTime).toBe(100);
    expect(bound.theoreticalSpeedup).toBe(1);
    expect(bound.theoreticalEfficiency).toBe(1);
  });

  test("evaluates multiprocessor bounded execution time", () => {
    const W = 100;
    const S = 20;

    const b2 = calculateBrentsTheorem(W, S, 2);
    expect(b2.processorCount).toBe(2);
    expect(b2.lowerBound).toBe(50);
    expect(b2.upperBound).toBe(60);
    expect(b2.estimatedTime).toBeGreaterThanOrEqual(50);
    expect(b2.estimatedTime).toBeLessThanOrEqual(60);
    expect(b2.theoreticalSpeedup).toBe(1.67);
    expect(b2.theoreticalEfficiency).toBe(0.83);

    const b4 = calculateBrentsTheorem(W, S, 4);
    expect(b4.processorCount).toBe(4);
    expect(b4.lowerBound).toBe(25);
    expect(b4.upperBound).toBe(40);
    expect(b4.estimatedTime).toBeGreaterThanOrEqual(25);
    expect(b4.estimatedTime).toBeLessThanOrEqual(40);
    expect(b4.theoreticalSpeedup).toBeGreaterThan(b2.theoreticalSpeedup);

    const b10 = calculateBrentsTheorem(W, S, 10);
    expect(b10.processorCount).toBe(10);
    expect(b10.lowerBound).toBe(20);
    expect(b10.upperBound).toBe(28);
  });

  test("evaluates infinite processors asymptotic convergence to critical span", () => {
    const W = 80;
    const S = 10;
    const bInf = calculateBrentsTheorem(W, S, 1000);

    expect(bInf.lowerBound).toBe(10);
    expect(bInf.upperBound).toBe(10);
    expect(bInf.estimatedTime).toBe(10);
    expect(bInf.theoreticalSpeedup).toBe(8);
  });

  test("handles zero work and span correctly", () => {
    const b0 = calculateBrentsTheorem(0, 0, 4);
    expect(b0.lowerBound).toBe(1);
    expect(b0.upperBound).toBe(0);
    expect(b0.estimatedTime).toBe(1);
  });
});

describe("DAG Forensics: Critical Path Drag & Slack Analysis", () => {
  test("computes critical path drag and non-critical zero drag", () => {
    const tasks: readonly ForensicTaskNode[] = [
      { id: "root", effort: 4 },
      { id: "branch-a", effort: 6 },
      { id: "branch-b", effort: 2 },
      { id: "join", effort: 3 },
    ];
    const deps = new Map<string, ReadonlySet<string>>([
      ["root", new Set<string>()],
      ["branch-a", new Set(["root"])],
      ["branch-b", new Set(["root"])],
      ["join", new Set(["branch-a", "branch-b"])],
    ]);

    const drags = computeCriticalPathDrag(tasks, deps);

    const rootDrag = drags.find((d) => d.taskId === "root");
    expect(rootDrag?.isCritical).toBe(true);
    expect(rootDrag?.drag).toBe(4);
    expect(rootDrag?.dragPercentage).toBeGreaterThan(0);
    expect(rootDrag?.dragCostSummary).toContain("Task root exerts 4 units of critical path drag");

    const branchADrag = drags.find((d) => d.taskId === "branch-a");
    expect(branchADrag?.isCritical).toBe(true);
    expect(branchADrag?.drag).toBe(4);

    const branchBDrag = drags.find((d) => d.taskId === "branch-b");
    expect(branchBDrag?.isCritical).toBe(false);
    expect(branchBDrag?.drag).toBe(0);
    expect(branchBDrag?.dragPercentage).toBe(0);
    expect(branchBDrag?.dragCostSummary).toContain("Task branch-b has 0 drag (non-critical");

    const joinDrag = drags.find((d) => d.taskId === "join");
    expect(joinDrag?.isCritical).toBe(true);
    expect(joinDrag?.drag).toBe(3);
  });

  test("computes exact task slack and free slack metrics", () => {
    const tasks: readonly ForensicTaskNode[] = [
      { id: "t-root", effort: 3 },
      { id: "t-short", effort: 2 },
      { id: "t-long", effort: 7 },
      { id: "t-sink", effort: 4 },
    ];
    const deps = new Map<string, ReadonlySet<string>>([
      ["t-root", new Set<string>()],
      ["t-short", new Set(["t-root"])],
      ["t-long", new Set(["t-root"])],
      ["t-sink", new Set(["t-short", "t-long"])],
    ]);

    const slackMap = computeTaskSlack(tasks, deps);

    const rootSlack = slackMap.get("t-root");
    expect(rootSlack?.isCritical).toBe(true);
    expect(rootSlack?.totalSlack).toBe(0);
    expect(rootSlack?.freeSlack).toBe(0);
    expect(rootSlack?.earliestStartTime).toBe(0);
    expect(rootSlack?.earliestFinishTime).toBe(3);
    expect(rootSlack?.latestStartTime).toBe(0);
    expect(rootSlack?.latestFinishTime).toBe(3);

    const longSlack = slackMap.get("t-long");
    expect(longSlack?.isCritical).toBe(true);
    expect(longSlack?.totalSlack).toBe(0);
    expect(longSlack?.earliestStartTime).toBe(3);
    expect(longSlack?.earliestFinishTime).toBe(10);

    const shortSlack = slackMap.get("t-short");
    expect(shortSlack?.isCritical).toBe(false);
    expect(shortSlack?.totalSlack).toBe(5);
    expect(shortSlack?.freeSlack).toBe(5);
    expect(shortSlack?.earliestStartTime).toBe(3);
    expect(shortSlack?.earliestFinishTime).toBe(5);
    expect(shortSlack?.latestStartTime).toBe(8);
    expect(shortSlack?.latestFinishTime).toBe(10);

    const sinkSlack = slackMap.get("t-sink");
    expect(sinkSlack?.isCritical).toBe(true);
    expect(sinkSlack?.totalSlack).toBe(0);
    expect(sinkSlack?.earliestStartTime).toBe(10);
    expect(sinkSlack?.earliestFinishTime).toBe(14);
  });
});
