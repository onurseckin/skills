import { describe, expect, it } from "bun:test";
import { detectCyclesTarjan, healDag } from "../../../olt/scripts/src/engine/dag/index.ts";
import type { DagTaskNode } from "../../../olt/scripts/src/engine/dag/index.ts";

describe("DAG Engine - Healing & Decoupling", () => {
  it("removes self-loops", () => {
    const tasks: DagTaskNode[] = [{ id: "t1", dependencies: ["t1"] }];
    const res = healDag(tasks);
    expect(res.healed).toBe(true);
    expect(res.healedTasks[0]!.dependencies).toEqual([]);
    expect(res.removedEdges).toEqual([{ from: "t1", to: "t1" }]);
  });

  it("prunes dangling dependencies", () => {
    const tasks: DagTaskNode[] = [{ id: "t1", dependencies: ["non-existent-task"] }];
    const res = healDag(tasks);
    expect(res.healed).toBe(true);
    expect(res.healedTasks[0]!.dependencies).toEqual([]);
  });

  it("heals cyclic graphs by pruning feedback arcs", () => {
    const tasks: DagTaskNode[] = [
      { id: "a", dependencies: ["c"] },
      { id: "b", dependencies: ["a"] },
      { id: "c", dependencies: ["b"] },
    ];
    const res = healDag(tasks, { mode: "prune" });
    expect(res.healed).toBe(true);
    expect(res.removedEdges.length).toBeGreaterThanOrEqual(1);

    const checkAfter = detectCyclesTarjan(res.healedTasks);
    expect(checkAfter.acyclic).toBe(true);
  });

  it("heals cyclic graphs by inverting feedback arcs when possible", () => {
    const tasks: DagTaskNode[] = [
      { id: "a", dependencies: ["b"] },
      { id: "b", dependencies: ["a"] },
    ];
    const res = healDag(tasks, { mode: "invert" });
    expect(res.healed).toBe(true);

    const checkAfter = detectCyclesTarjan(res.healedTasks);
    expect(checkAfter.acyclic).toBe(true);
  });

  it("computes topological execution waves", () => {
    const tasks: DagTaskNode[] = [
      { id: "root1", dependencies: [] },
      { id: "root2", dependencies: [] },
      { id: "mid", dependencies: ["root1", "root2"] },
      { id: "leaf", dependencies: ["mid"] },
    ];
    const res = healDag(tasks);
    expect(res.waves).toHaveLength(3);
    expect(res.waves[0]).toEqual(["root1", "root2"]);
    expect(res.waves[1]).toEqual(["mid"]);
    expect(res.waves[2]).toEqual(["leaf"]);
  });
});
