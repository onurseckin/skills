import { describe, expect, it } from "bun:test";
import { detectCyclesTarjan } from "../../../olt/scripts/src/engine/dag/index.ts";
import type { DagTaskNode } from "../../../olt/scripts/src/engine/dag/index.ts";

describe("DAG Engine - Tarjan SCC Cycle Detection", () => {
  it("reports acyclic for empty graph", () => {
    const res = detectCyclesTarjan([]);
    expect(res.acyclic).toBe(true);
    expect(res.sccs).toHaveLength(0);
    expect(res.cycles).toHaveLength(0);
    expect(res.feedbackArcs).toHaveLength(0);
  });

  it("reports acyclic for linear DAG", () => {
    const tasks: DagTaskNode[] = [
      { id: "t1", dependencies: [] },
      { id: "t2", dependencies: ["t1"] },
      { id: "t3", dependencies: ["t2"] },
    ];
    const res = detectCyclesTarjan(tasks);
    expect(res.acyclic).toBe(true);
    expect(res.sccs).toHaveLength(0);
    expect(res.cycles).toHaveLength(0);
  });

  it("detects self-loop cycle", () => {
    const tasks: DagTaskNode[] = [{ id: "t1", dependencies: ["t1"] }];
    const res = detectCyclesTarjan(tasks);
    expect(res.acyclic).toBe(false);
    expect(res.sccs).toHaveLength(1);
    expect(res.cycles).toHaveLength(1);
    expect(res.feedbackArcs).toEqual([{ from: "t1", to: "t1" }]);
  });

  it("detects 2-node cycle", () => {
    const tasks: DagTaskNode[] = [
      { id: "t1", dependencies: ["t2"] },
      { id: "t2", dependencies: ["t1"] },
    ];
    const res = detectCyclesTarjan(tasks);
    expect(res.acyclic).toBe(false);
    expect(res.sccs).toHaveLength(1);
    expect(res.feedbackArcs.length).toBeGreaterThanOrEqual(1);
  });

  it("detects multi-node cycle within larger graph", () => {
    const tasks: DagTaskNode[] = [
      { id: "t0", dependencies: [] },
      { id: "t1", dependencies: ["t0", "t3"] },
      { id: "t2", dependencies: ["t1"] },
      { id: "t3", dependencies: ["t2"] },
      { id: "t4", dependencies: ["t3"] },
    ];
    const res = detectCyclesTarjan(tasks);
    expect(res.acyclic).toBe(false);
    expect(res.sccs).toHaveLength(1);
    expect(res.sccs[0]).toContain("t1");
    expect(res.sccs[0]).toContain("t2");
    expect(res.sccs[0]).toContain("t3");
  });
});
