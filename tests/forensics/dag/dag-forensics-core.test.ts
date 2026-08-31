import { describe, expect, test } from "bun:test";
import {
  breakCycles,
  describeCycle,
  findCycles,
  isAcyclic,
  topologicalOrder,
} from "../../../olt/scripts/src/graph/dag-forensics.ts";

describe("DAG Forensics: Topological Sorting & Acyclicity", () => {
  test("topologicalOrder returns empty array on empty graph", () => {
    const emptyGraph = new Map<string, ReadonlySet<string>>();
    expect(topologicalOrder(emptyGraph)).toEqual([]);
    expect(isAcyclic(emptyGraph)).toBe(true);
  });

  test("topologicalOrder correctly orders linear sequential pipeline", () => {
    const deps = new Map<string, ReadonlySet<string>>([
      ["t1", new Set<string>()],
      ["t2", new Set(["t1"])],
      ["t3", new Set(["t2"])],
      ["t4", new Set(["t3"])],
    ]);
    expect(topologicalOrder(deps)).toEqual(["t1", "t2", "t3", "t4"]);
    expect(isAcyclic(deps)).toBe(true);
  });

  test("topologicalOrder deterministically breaks ties lexicographically", () => {
    const deps = new Map<string, ReadonlySet<string>>([
      ["gamma", new Set<string>()],
      ["alpha", new Set<string>()],
      ["beta", new Set<string>()],
      ["omega", new Set(["alpha", "beta", "gamma"])],
    ]);
    expect(topologicalOrder(deps)).toEqual(["alpha", "beta", "gamma", "omega"]);
  });

  test("topologicalOrder handles complex diamond and multi-root graph", () => {
    const deps = new Map<string, ReadonlySet<string>>([
      ["root-1", new Set<string>()],
      ["root-2", new Set<string>()],
      ["mid-a", new Set(["root-1"])],
      ["mid-b", new Set(["root-1", "root-2"])],
      ["mid-c", new Set(["root-2"])],
      ["leaf", new Set(["mid-a", "mid-b", "mid-c"])],
    ]);
    const order = topologicalOrder(deps);
    expect(order.indexOf("root-1")).toBeLessThan(order.indexOf("mid-a"));
    expect(order.indexOf("root-1")).toBeLessThan(order.indexOf("mid-b"));
    expect(order.indexOf("root-2")).toBeLessThan(order.indexOf("mid-b"));
    expect(order.indexOf("root-2")).toBeLessThan(order.indexOf("mid-c"));
    expect(order.indexOf("mid-a")).toBeLessThan(order.indexOf("leaf"));
    expect(order.indexOf("mid-b")).toBeLessThan(order.indexOf("leaf"));
    expect(order.indexOf("mid-c")).toBeLessThan(order.indexOf("leaf"));
    expect(order.length).toBe(6);
  });
});

describe("DAG Forensics: Cycle Detection, Description & Breaking", () => {
  test("findCycles detects 2-cycle and returns cycle path", () => {
    const deps = new Map<string, ReadonlySet<string>>([
      ["task-a", new Set(["task-b"])],
      ["task-b", new Set(["task-a"])],
    ]);
    expect(isAcyclic(deps)).toBe(false);
    const cycles = findCycles(deps);
    expect(cycles.length).toBeGreaterThan(0);
    const firstCycle = cycles[0];
    expect(firstCycle).toBeDefined();
    if (firstCycle !== undefined) {
      expect(firstCycle).toContain("task-a");
      expect(firstCycle).toContain("task-b");
    }
  });

  test("describeCycle formats exact human-readable cycle and names break edge", () => {
    const deps = new Map<string, ReadonlySet<string>>([
      ["task-1", new Set(["task-2"])],
      ["task-2", new Set(["task-1"])],
    ]);
    const desc = describeCycle(deps);
    expect(desc).toContain("task-1 --deps task-2 and task-2 --deps task-1 form a cycle");
    expect(desc).toContain("drop task-1 --deps task-2 to break it");
  });

  test("describeCycle describes 3-cycle correctly with Oxford comma", () => {
    const deps = new Map<string, ReadonlySet<string>>([
      ["a", new Set(["b"])],
      ["b", new Set(["c"])],
      ["c", new Set(["a"])],
    ]);
    const desc = describeCycle(deps);
    expect(desc).toContain("a --deps b, b --deps c, and c --deps a form a cycle");
    expect(desc).toContain("drop a --deps b to break it");
  });

  test("describeCycle returns 'no cycle detected' for acyclic graphs", () => {
    const deps = new Map<string, ReadonlySet<string>>([
      ["a", new Set<string>()],
      ["b", new Set(["a"])],
    ]);
    expect(describeCycle(deps)).toBe("no cycle detected");
  });

  test("breakCycles automatically drops minimal feedback edges to restore acyclicity", () => {
    const cyclicDeps = new Map<string, ReadonlySet<string>>([
      ["task-x", new Set(["task-y"])],
      ["task-y", new Set(["task-z"])],
      ["task-z", new Set(["task-x"])],
      ["task-independent", new Set<string>()],
    ]);

    expect(isAcyclic(cyclicDeps)).toBe(false);

    const { acyclicDependencies, brokenEdges } = breakCycles(cyclicDeps);

    expect(isAcyclic(acyclicDependencies)).toBe(true);
    expect(brokenEdges.length).toBeGreaterThanOrEqual(1);
    expect(topologicalOrder(acyclicDependencies).length).toBe(4);
  });
});
