import { describe, expect, it } from "bun:test";
import { calculateBrentMetrics } from "../../../olt/scripts/src/engine/dag/index.ts";
import type { DagTaskNode } from "../../../olt/scripts/src/engine/dag/index.ts";

describe("DAG Engine - Brent Work/Span Computational Analysis", () => {
  it("computes default metrics for empty tasks", () => {
    const res = calculateBrentMetrics([]);
    expect(res.totalWork).toBe(0);
    expect(res.criticalSpan).toBe(1);
    expect(res.recommendedProcessors).toBe(1);
  });

  it("calculates W, S, and P = ceil(W/S) for sequential chain", () => {
    const tasks: DagTaskNode[] = [
      { id: "t1", dependencies: [], effort: 2 },
      { id: "t2", dependencies: ["t1"], effort: 3 },
      { id: "t3", dependencies: ["t2"], effort: 5 },
    ];
    const res = calculateBrentMetrics(tasks);
    expect(res.totalWork).toBe(10);
    expect(res.criticalSpan).toBe(10);
    expect(res.recommendedProcessors).toBe(1); // ceil(10/10) = 1
  });

  it("calculates W, S, and P for parallel tasks", () => {
    const tasks: DagTaskNode[] = [
      { id: "t1", dependencies: [], effort: 2 },
      { id: "t2", dependencies: [], effort: 2 },
      { id: "t3", dependencies: [], effort: 2 },
      { id: "t4", dependencies: [], effort: 2 },
    ];
    const res = calculateBrentMetrics(tasks);
    expect(res.totalWork).toBe(8);
    expect(res.criticalSpan).toBe(2);
    expect(res.recommendedProcessors).toBe(4); // ceil(8/2) = 4
    expect(res.theoreticalSpeedup).toBe(4);
  });

  it("calculates bounds for diamond graph", () => {
    const tasks: DagTaskNode[] = [
      { id: "root", dependencies: [], effort: 1 },
      { id: "left", dependencies: ["root"], effort: 2 },
      { id: "right", dependencies: ["root"], effort: 2 },
      { id: "join", dependencies: ["left", "right"], effort: 1 },
    ];
    const res = calculateBrentMetrics(tasks);
    expect(res.totalWork).toBe(6);
    expect(res.criticalSpan).toBe(4); // 1 + 2 + 1
    expect(res.recommendedProcessors).toBe(2); // ceil(6/4) = 2
    expect(res.lowerBoundTime).toBeGreaterThanOrEqual(4);
  });
});
