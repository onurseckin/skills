import { describe, expect, test } from "bun:test";
import {
  computeCriticalPathDrag,
  computeTaskSlack,
  computeWorkSpan,
  type ForensicTaskNode,
} from "../../../../olt/scripts/src/graph/dag-forensics.ts";
import { downstreamMap, topologicalOrder } from "../../../../olt/scripts/src/graph/topology.ts";

describe("Forensics Critical Path & Longest-Path Dynamic Programming", () => {
  test("computes topological order on complex DAG with multiple roots and sinks", () => {
    const deps = new Map<string, ReadonlySet<string>>([
      ["root-a", new Set<string>()],
      ["root-b", new Set<string>()],
      ["stage-1", new Set(["root-a"])],
      ["stage-2", new Set(["root-a", "root-b"])],
      ["stage-3", new Set(["root-b"])],
      ["join-1", new Set(["stage-1", "stage-2"])],
      ["join-2", new Set(["stage-2", "stage-3"])],
      ["final-sink", new Set(["join-1", "join-2"])],
    ]);

    const order = topologicalOrder(deps);
    expect(order.length).toBe(8);
    expect(order.indexOf("root-a")).toBeLessThan(order.indexOf("stage-1"));
    expect(order.indexOf("root-a")).toBeLessThan(order.indexOf("stage-2"));
    expect(order.indexOf("root-b")).toBeLessThan(order.indexOf("stage-2"));
    expect(order.indexOf("root-b")).toBeLessThan(order.indexOf("stage-3"));
    expect(order.indexOf("stage-1")).toBeLessThan(order.indexOf("join-1"));
    expect(order.indexOf("stage-2")).toBeLessThan(order.indexOf("join-1"));
    expect(order.indexOf("stage-2")).toBeLessThan(order.indexOf("join-2"));
    expect(order.indexOf("stage-3")).toBeLessThan(order.indexOf("join-2"));
    expect(order.indexOf("join-1")).toBeLessThan(order.indexOf("final-sink"));
    expect(order.indexOf("join-2")).toBeLessThan(order.indexOf("final-sink"));
  });

  test("extracts longest critical path across asymmetric parallel branches", () => {
    const tasks: readonly ForensicTaskNode[] = [
      { id: "genesis", effort: 5 },
      { id: "fast-lane-1", effort: 2 },
      { id: "fast-lane-2", effort: 3 },
      { id: "medium-lane", effort: 8 },
      { id: "heavy-lane-1", effort: 6 },
      { id: "heavy-lane-2", effort: 7 },
      { id: "heavy-lane-3", effort: 4 },
      { id: "terminal", effort: 5 },
    ];

    const deps = new Map<string, ReadonlySet<string>>([
      ["genesis", new Set<string>()],
      ["fast-lane-1", new Set(["genesis"])],
      ["fast-lane-2", new Set(["fast-lane-1"])],
      ["medium-lane", new Set(["genesis"])],
      ["heavy-lane-1", new Set(["genesis"])],
      ["heavy-lane-2", new Set(["heavy-lane-1"])],
      ["heavy-lane-3", new Set(["heavy-lane-2"])],
      ["terminal", new Set(["fast-lane-2", "medium-lane", "heavy-lane-3"])],
    ]);

    const metrics = computeWorkSpan(tasks, deps);
    expect(metrics.totalWork).toBe(40);
    expect(metrics.criticalSpan).toBe(27);
    expect(metrics.criticalPath).toEqual([
      "genesis",
      "heavy-lane-1",
      "heavy-lane-2",
      "heavy-lane-3",
      "terminal",
    ]);

    const slackMap = computeTaskSlack(tasks, deps);
    expect(slackMap.get("genesis")?.totalSlack).toBe(0);
    expect(slackMap.get("heavy-lane-1")?.totalSlack).toBe(0);
    expect(slackMap.get("heavy-lane-2")?.totalSlack).toBe(0);
    expect(slackMap.get("heavy-lane-3")?.totalSlack).toBe(0);
    expect(slackMap.get("terminal")?.totalSlack).toBe(0);

    expect(slackMap.get("medium-lane")?.totalSlack).toBe(9);
    expect(slackMap.get("fast-lane-1")?.totalSlack).toBe(12);
    expect(slackMap.get("fast-lane-2")?.totalSlack).toBe(12);
  });

  test("calculates critical path drag across competing paths", () => {
    const tasks: readonly ForensicTaskNode[] = [
      { id: "start", effort: 10 },
      { id: "branch-alpha", effort: 15 },
      { id: "branch-beta", effort: 12 },
      { id: "finish", effort: 5 },
    ];

    const deps = new Map<string, ReadonlySet<string>>([
      ["start", new Set<string>()],
      ["branch-alpha", new Set(["start"])],
      ["branch-beta", new Set(["start"])],
      ["finish", new Set(["branch-alpha", "branch-beta"])],
    ]);

    const drags = computeCriticalPathDrag(tasks, deps);
    const startDrag = drags.find((d) => d.taskId === "start");
    const alphaDrag = drags.find((d) => d.taskId === "branch-alpha");
    const betaDrag = drags.find((d) => d.taskId === "branch-beta");
    const finishDrag = drags.find((d) => d.taskId === "finish");

    expect(startDrag?.isCritical).toBe(true);
    expect(startDrag?.drag).toBe(10);

    expect(alphaDrag?.isCritical).toBe(true);
    expect(alphaDrag?.drag).toBe(3);

    expect(betaDrag?.isCritical).toBe(false);
    expect(betaDrag?.drag).toBe(0);

    expect(finishDrag?.isCritical).toBe(true);
    expect(finishDrag?.drag).toBe(5);
  });

  test("correctly maps downstream dependencies", () => {
    const deps = new Map<string, ReadonlySet<string>>([
      ["t1", new Set<string>()],
      ["t2", new Set(["t1"])],
      ["t3", new Set(["t1"])],
      ["t4", new Set(["t2", "t3"])],
    ]);

    const downstream = downstreamMap(deps);
    expect([...(downstream.get("t1") ?? [])].sort()).toEqual(["t2", "t3"]);
    expect([...(downstream.get("t2") ?? [])]).toEqual(["t4"]);
    expect([...(downstream.get("t3") ?? [])]).toEqual(["t4"]);
    expect([...(downstream.get("t4") ?? [])]).toEqual([]);
  });

  test("handles dynamic programming longest-path with tied multiple critical branches", () => {
    const tasks: readonly ForensicTaskNode[] = [
      { id: "root", effort: 2 },
      { id: "path-1", effort: 5 },
      { id: "path-2", effort: 5 },
      { id: "sink", effort: 3 },
    ];

    const deps = new Map<string, ReadonlySet<string>>([
      ["root", new Set<string>()],
      ["path-1", new Set(["root"])],
      ["path-2", new Set(["root"])],
      ["sink", new Set(["path-1", "path-2"])],
    ]);

    const metrics = computeWorkSpan(tasks, deps);
    expect(metrics.totalWork).toBe(15);
    expect(metrics.criticalSpan).toBe(10);
    expect(metrics.criticalPath.length).toBe(3);
    expect(metrics.criticalPath[0]).toBe("root");
    expect(metrics.criticalPath[2]).toBe("sink");
  });
});
