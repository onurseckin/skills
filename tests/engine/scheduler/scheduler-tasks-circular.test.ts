import { describe, expect, it } from "bun:test";
import { probeCircularDependencies } from "../../../olt/scripts/src/engine/scheduler/core/tasks/tasks-circular.ts";

describe("engine/scheduler/core/tasks/tasks-circular.ts", () => {
  it("returns default passed result when state is not a record", () => {
    const resultNull = probeCircularDependencies(null);
    expect(resultNull.passed).toBe(true);
    expect(resultNull.hasCycles).toBe(false);
    expect(resultNull.cycles).toEqual([]);
    expect(resultNull.cycleDescriptions).toEqual([]);
    expect(resultNull.details).toEqual([]);
  });

  it("detects no cycles in valid acyclic graph", () => {
    const state = {
      graph: {
        schema: "harness.graph",
        version: 1,
        revision: 1,
        nodes: [
          { id: "t1", type: "task" },
          { id: "t2", type: "task" },
          { id: "t3", type: "task" },
        ],
        edges: [
          { source: "t1", target: "t2", type: "depends_on" },
          { source: "t2", target: "t3", type: "depends_on" },
        ],
        gates: [],
      },
    };

    const result = probeCircularDependencies(state);
    expect(result.passed).toBe(true);
    expect(result.hasCycles).toBe(false);
    expect(result.cycles).toEqual([]);
  });

  it("detects cycles in graph mode", () => {
    const state = {
      graph: {
        schema: "harness.graph",
        version: 1,
        revision: 1,
        nodes: [
          { id: "t1", type: "task" },
          { id: "t2", type: "task" },
        ],
        edges: [
          { source: "t1", target: "t2", type: "depends_on" },
          { source: "t2", target: "t1", type: "depends_on" },
        ],
        gates: [],
      },
    };

    const result = probeCircularDependencies(state);
    expect(result.passed).toBe(false);
    expect(result.hasCycles).toBe(true);
    expect(result.cycleDescriptions.length).toBeGreaterThan(0);
    expect(result.cycleDescriptions[0]).toContain("cycle");
  });

  it("catches and records errors from throwing graph getters", () => {
    const state = {
      graph: {
        schema: "harness.graph",
        get nodes(): Record<string, unknown>[] {
          throw new Error("Graph nodes retrieval exploded");
        },
      },
    };

    const result = probeCircularDependencies(state);
    expect(result.passed).toBe(false);
    expect(result.hasCycles).toBe(true);
    expect(result.cycleDescriptions).toContain("Graph nodes retrieval exploded");
    expect(result.details).toContain("Graph nodes retrieval exploded");
  });

  it("detects self-dependencies in tasks-only mode", () => {
    const state = {
      tasks: {
        t1: {
          id: "t1",
          dependencies: ["t1"], // self-dependency
        },
      },
    };

    const result = probeCircularDependencies(state);
    expect(result.passed).toBe(false);
    expect(result.hasCycles).toBe(true);
    expect(result.cycleDescriptions).toContain("Task 't1' has self-dependency on itself.");
    expect(result.details).toContain("Task 't1' has self-dependency on itself.");
  });

  it("detects multi-node cycles in tasks-only mode via DFS", () => {
    const state = {
      tasks: {
        t1: {
          id: "t1",
          dependencies: ["t2"],
        },
        t2: {
          id: "t2",
          dependencies: ["t3"],
        },
        t3: {
          id: "t3",
          dependencies: ["t1"], // cycle: t1 -> t2 -> t3 -> t1
        },
        t4: {
          id: "t4",
          dependencies: ["t3"], // non-cyclic attachment
        },
        tNull: null, // non-record ignored
      },
    };

    const result = probeCircularDependencies(state);
    expect(result.passed).toBe(false);
    expect(result.hasCycles).toBe(true);
    expect(result.cycles.length).toBeGreaterThanOrEqual(1);
    expect(result.cycleDescriptions.some((d) => d.includes("Cycle detected"))).toBe(true);
  });

  it("verifies acyclic diamond topology in tasks-only mode", () => {
    const state = {
      tasks: {
        t1: { id: "t1", dependencies: [] },
        t2: { id: "t2", dependencies: ["t1"] },
        t3: { id: "t3", dependencies: ["t1"] },
        t4: { id: "t4", dependencies: ["t2", "t3"] },
      },
    };

    const result = probeCircularDependencies(state);
    expect(result.passed).toBe(true);
    expect(result.hasCycles).toBe(false);
    expect(result.cycles).toEqual([]);
    expect(result.cycleDescriptions).toEqual([]);
  });
});
