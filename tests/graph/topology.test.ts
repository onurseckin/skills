import { describe, expect, test } from "bun:test";
import {
  dependencyData,
  downstreamMap,
  topologicalOrder,
} from "../../olt/scripts/src/graph/topology.ts";

describe("topologicalOrder", () => {
  test("an empty dependency map orders to nothing", () => {
    expect(topologicalOrder(new Map())).toEqual([]);
  });

  test("orders a linear chain from root to leaf", () => {
    const dependencies = new Map([
      ["a", new Set<string>()],
      ["b", new Set(["a"])],
      ["c", new Set(["b"])],
    ]);
    expect(topologicalOrder(dependencies)).toEqual(["a", "b", "c"]);
  });

  test("independent roots and a fan-in node are inserted lexicographically into a non-empty ready queue", () => {
    // Diamond: a has no prerequisites; b and c both depend only on a; d depends on both.
    // When a finishes, b and c become ready in the same pass — inserting c must walk past the
    // already-queued b, exercising the ready queue's insertion-order search rather than only its
    // empty-queue fast path.
    const dependencies = new Map([
      ["a", new Set<string>()],
      ["b", new Set(["a"])],
      ["c", new Set(["a"])],
      ["d", new Set(["b", "c"])],
    ]);
    expect(topologicalOrder(dependencies)).toEqual(["a", "b", "c", "d"]);
  });

  test("multiple independent roots are emitted in lexicographic order", () => {
    const dependencies = new Map([
      ["z", new Set<string>()],
      ["a", new Set<string>()],
      ["m", new Set<string>()],
    ]);
    expect(topologicalOrder(dependencies)).toEqual(["a", "m", "z"]);
  });

  test("a cycle leaves nodes permanently blocked, so the order omits them", () => {
    const dependencies = new Map([
      ["a", new Set(["b"])],
      ["b", new Set(["a"])],
    ]);
    expect(topologicalOrder(dependencies)).toEqual([]);
  });
});

describe("dependencyData", () => {
  test("collects only depends_on edges between known tasks", () => {
    const nodes = [
      { id: "task-1", type: "task" },
      { id: "task-2", type: "task" },
      { id: "artifact-1", type: "artifact" },
    ];
    const edges = [
      { source: "task-2", target: "task-1", type: "depends_on" },
      { source: "task-2", target: "artifact-1", type: "produces" },
    ];
    const { dependencies, issues } = dependencyData(nodes, edges);
    expect(issues).toEqual([]);
    expect(dependencies.get("task-2")).toEqual(new Set(["task-1"]));
    expect(dependencies.get("task-1")).toEqual(new Set());
  });

  test("flags a depends_on edge pointing outside the known task set, and self-dependency", () => {
    const nodes = [{ id: "task-1", type: "task" }];
    const edges = [
      { source: "task-1", target: "missing", type: "depends_on" },
      { source: "task-1", target: "task-1", type: "depends_on" },
    ];
    const { issues } = dependencyData(nodes, edges);
    expect(issues).toContain("depends_on edge task-1 --deps missing must connect two tasks");
    expect(issues).toContain("task task-1 cannot depend on itself; drop task-1 --deps task-1");
  });

  test("flags a dependency cycle and names the participating tasks, edges, and a break", () => {
    const nodes = [
      { id: "task-1", type: "task" },
      { id: "task-2", type: "task" },
    ];
    const edges = [
      { source: "task-1", target: "task-2", type: "depends_on" },
      { source: "task-2", target: "task-1", type: "depends_on" },
    ];
    const { issues } = dependencyData(nodes, edges);
    expect(issues).toContain(
      "task-1 --deps task-2 and task-2 --deps task-1 form a cycle; drop task-1 --deps task-2 to break it",
    );
  });

  test("flags a longer cycle by walking prerequisites back to the first repeat", () => {
    const nodes = [
      { id: "task-1", type: "task" },
      { id: "task-2", type: "task" },
      { id: "task-3", type: "task" },
    ];
    const edges = [
      { source: "task-1", target: "task-2", type: "depends_on" },
      { source: "task-2", target: "task-3", type: "depends_on" },
      { source: "task-3", target: "task-1", type: "depends_on" },
    ];
    const { issues } = dependencyData(nodes, edges);
    expect(issues).toContain(
      "task-1 --deps task-2, task-2 --deps task-3, and task-3 --deps task-1 form a cycle; " +
        "drop task-1 --deps task-2 to break it",
    );
  });

  test("names only the cycle itself, not a task merely blocked behind it", () => {
    const nodes = [
      { id: "task-1", type: "task" },
      { id: "task-2", type: "task" },
      { id: "task-3", type: "task" },
    ];
    const edges = [
      { source: "task-1", target: "task-2", type: "depends_on" },
      { source: "task-2", target: "task-1", type: "depends_on" },
      { source: "task-3", target: "task-1", type: "depends_on" },
    ];
    const { issues } = dependencyData(nodes, edges);
    expect(issues).toContain(
      "task-1 --deps task-2 and task-2 --deps task-1 form a cycle; drop task-1 --deps task-2 to break it",
    );
    expect(issues.some((issue) => issue.includes("task-3"))).toBe(false);
  });
});

describe("downstreamMap", () => {
  test("inverts a dependency map into who depends on whom", () => {
    const dependencies = new Map([
      ["a", new Set<string>()],
      ["b", new Set(["a"])],
      ["c", new Set(["a"])],
    ]);
    const downstream = downstreamMap(dependencies);
    expect(downstream.get("a")).toEqual(new Set(["b", "c"]));
    expect(downstream.get("b")).toEqual(new Set());
  });

  test("a node with no dependents still appears with an empty downstream set", () => {
    const downstream = downstreamMap(new Map([["only", new Set<string>()]]));
    expect(downstream.get("only")).toEqual(new Set());
  });
});
