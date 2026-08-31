import { describe, expect, test } from "bun:test";
import {
  calculateBrentsTheorem,
  computeCriticalPathDrag,
  computeWorkSpan,
  detectFanOutBottlenecks,
  type ForensicTaskNode,
} from "../../../olt/scripts/src/graph/dag-forensics.ts";

describe("DAG Forensics: Work / Span Mathematics & Brent's Theorem", () => {
  test("computeWorkSpan calculates total work, critical span, and parallelism for sequential chain", () => {
    const tasks: ForensicTaskNode[] = [
      { id: "t1", effort: 2 },
      { id: "t2", effort: 3 },
      { id: "t3", effort: 5 },
    ];
    const deps = new Map<string, ReadonlySet<string>>([
      ["t1", new Set<string>()],
      ["t2", new Set(["t1"])],
      ["t3", new Set(["t2"])],
    ]);

    const metrics = computeWorkSpan(tasks, deps);

    expect(metrics.totalWork).toBe(10);
    expect(metrics.criticalSpan).toBe(10);
    expect(metrics.parallelismFactor).toBe(1);
    expect(metrics.optimalLanes).toBe(1);
    expect(metrics.criticalPath).toEqual(["t1", "t2", "t3"]);
  });

  test("computeWorkSpan calculates metrics for perfectly parallel tasks", () => {
    const tasks: ForensicTaskNode[] = [
      { id: "t1", effort: 4 },
      { id: "t2", effort: 4 },
      { id: "t3", effort: 4 },
      { id: "t4", effort: 4 },
    ];
    const deps = new Map<string, ReadonlySet<string>>([
      ["t1", new Set<string>()],
      ["t2", new Set<string>()],
      ["t3", new Set<string>()],
      ["t4", new Set<string>()],
    ]);

    const metrics = computeWorkSpan(tasks, deps);

    expect(metrics.totalWork).toBe(16);
    expect(metrics.criticalSpan).toBe(4);
    expect(metrics.parallelismFactor).toBe(4);
    expect(metrics.optimalLanes).toBe(4);
  });

  test("computeWorkSpan correctly identifies critical path in asymmetric diamond DAG", () => {
    const tasks: ForensicTaskNode[] = [
      { id: "root", effort: 2 },
      { id: "fast-branch", effort: 1 },
      { id: "slow-branch-1", effort: 4 },
      { id: "slow-branch-2", effort: 3 },
      { id: "join", effort: 2 },
    ];
    const deps = new Map<string, ReadonlySet<string>>([
      ["root", new Set<string>()],
      ["fast-branch", new Set(["root"])],
      ["slow-branch-1", new Set(["root"])],
      ["slow-branch-2", new Set(["slow-branch-1"])],
      ["join", new Set(["fast-branch", "slow-branch-2"])],
    ]);

    const metrics = computeWorkSpan(tasks, deps);

    expect(metrics.totalWork).toBe(12);
    expect(metrics.criticalSpan).toBe(11);
    expect(metrics.parallelismFactor).toBe(1.09);
    expect(metrics.criticalPath).toEqual(["root", "slow-branch-1", "slow-branch-2", "join"]);
  });

  test("calculateBrentsTheorem computes exact lower bound, upper bound, and speedup", () => {
    const W = 100;
    const S = 20;

    const b1 = calculateBrentsTheorem(W, S, 1);
    expect(b1.lowerBound).toBe(100);
    expect(b1.upperBound).toBe(100);
    expect(b1.theoreticalSpeedup).toBe(1);
    expect(b1.theoreticalEfficiency).toBe(1);

    const b4 = calculateBrentsTheorem(W, S, 4);
    expect(b4.lowerBound).toBe(25);
    expect(b4.upperBound).toBe(40);
    expect(b4.estimatedTime).toBeGreaterThanOrEqual(25);
    expect(b4.estimatedTime).toBeLessThanOrEqual(40);
    expect(b4.theoreticalSpeedup).toBeGreaterThan(1);
  });
});

describe("DAG Forensics: Critical Path Drag Analysis", () => {
  test("computeCriticalPathDrag calculates drag for all nodes", () => {
    const tasks: ForensicTaskNode[] = [
      { id: "root", effort: 3 },
      { id: "fast", effort: 2 },
      { id: "slow", effort: 6 },
      { id: "sink", effort: 4 },
    ];
    const deps = new Map<string, ReadonlySet<string>>([
      ["root", new Set<string>()],
      ["fast", new Set(["root"])],
      ["slow", new Set(["root"])],
      ["sink", new Set(["fast", "slow"])],
    ]);

    const drags = computeCriticalPathDrag(tasks, deps);

    const rootDrag = drags.find((d) => d.taskId === "root");
    expect(rootDrag).toBeDefined();
    if (rootDrag !== undefined) {
      expect(rootDrag.isCritical).toBe(true);
      expect(rootDrag.drag).toBe(3);
      expect(rootDrag.dragCostSummary).toContain("root exerts 3 units");
    }

    const slowDrag = drags.find((d) => d.taskId === "slow");
    expect(slowDrag).toBeDefined();
    if (slowDrag !== undefined) {
      expect(slowDrag.isCritical).toBe(true);
      expect(slowDrag.drag).toBe(4);
    }

    const fastDrag = drags.find((d) => d.taskId === "fast");
    expect(fastDrag).toBeDefined();
    if (fastDrag !== undefined) {
      expect(fastDrag.isCritical).toBe(false);
      expect(fastDrag.drag).toBe(0);
      expect(fastDrag.dragCostSummary).toContain("0 drag (non-critical");
    }

    const sinkDrag = drags.find((d) => d.taskId === "sink");
    expect(sinkDrag).toBeDefined();
    if (sinkDrag !== undefined) {
      expect(sinkDrag.isCritical).toBe(true);
      expect(sinkDrag.drag).toBe(4);
    }
  });
});

describe("DAG Forensics: Fan-Out Bottleneck Detection", () => {
  test("detectFanOutBottlenecks detects high fan-out gates", () => {
    const tasks: ForensicTaskNode[] = [
      { id: "producer", effort: 2 },
      { id: "c1", effort: 3 },
      { id: "c2", effort: 4 },
      { id: "c3", effort: 5 },
      { id: "unrelated", effort: 1 },
    ];
    const deps = new Map<string, ReadonlySet<string>>([
      ["producer", new Set<string>()],
      ["c1", new Set(["producer"])],
      ["c2", new Set(["producer"])],
      ["c3", new Set(["producer"])],
      ["unrelated", new Set<string>()],
    ]);

    const bottlenecks = detectFanOutBottlenecks(tasks, deps, 2);

    expect(bottlenecks.length).toBe(1);
    const b = bottlenecks[0];
    expect(b).toBeDefined();
    if (b !== undefined) {
      expect(b.taskId).toBe("producer");
      expect(b.fanOutCount).toBe(3);
      expect(b.blockedEffort).toBe(12);
      expect(b.downstreamTaskIds).toEqual(["c1", "c2", "c3"]);
      expect(b.impactDescription).toContain("producer gates 3 downstream tasks");
    }
  });
});
