import { describe, expect, test } from "bun:test";
import {
  analyzeTopologyDeclaration,
  assertTopologyJustified,
} from "../../../../olt/scripts/src/graph/topology-declaration.ts";
import {
  dependencyData,
  describeCycle,
  downstreamMap,
  topologicalOrder,
  type DependencyMap,
} from "../../../../olt/scripts/src/graph/topology.ts";
import { dependencyMap } from "../../../../olt/scripts/src/graph/dependency-map.ts";
import type { TaskDeclaration } from "../../../../olt/scripts/src/requirements/compiler.ts";

function task(overrides: Partial<TaskDeclaration> & Pick<TaskDeclaration, "id">): TaskDeclaration {
  return {
    label: overrides.id,
    writeScope: [`src/${overrides.id}`],
    gate: `bun test src/${overrides.id}`,
    ...overrides,
  };
}

describe("topology declaration and justification", () => {
  test("identifies independent roots when tasks have no declared dependencies", () => {
    const tasks = [
      task({ id: "alpha" }),
      task({ id: "beta" }),
      task({ id: "gamma", deps: ["alpha"], depReasons: { alpha: "requires alpha schema" } }),
    ];
    const result = analyzeTopologyDeclaration(tasks);
    expect(result.independentRoots).toEqual(["alpha", "beta"]);
    expect(result.totalTasks).toBe(3);
    expect(result.unjustifiedEdges).toEqual([]);
    expect(result.edges).toEqual([
      { task: "gamma", dependsOn: "alpha", justification: "requires alpha schema" },
    ]);
  });

  test("records justified edge with trimmed rationale", () => {
    const tasks = [
      task({ id: "t1" }),
      task({ id: "t2", deps: ["t1"], depReasons: { t1: "   consumes database migrations   " } }),
    ];
    const result = analyzeTopologyDeclaration(tasks);
    expect(result.edges).toEqual([
      { task: "t2", dependsOn: "t1", justification: "consumes database migrations" },
    ]);
    expect(result.unjustifiedEdges).toEqual([]);
    expect(() => assertTopologyJustified(result)).not.toThrow();
  });

  test("flags unjustified edges when depReason is missing or whitespace", () => {
    const tasks = [
      task({ id: "t1" }),
      task({ id: "t2", deps: ["t1"] }),
      task({ id: "t3", deps: ["t1"], depReasons: { t1: "   \t  \n " } }),
    ];
    const result = analyzeTopologyDeclaration(tasks);
    expect(result.unjustifiedEdges).toEqual([
      { task: "t2", dependsOn: "t1" },
      { task: "t3", dependsOn: "t1" },
    ]);
    expect(() => assertTopologyJustified(result)).toThrow(
      "dependency edge(s) without a declared justification: t2 -> t1, t3 -> t1",
    );
  });

  test("handles tasks with multiple dependency edges", () => {
    const tasks = [
      task({ id: "t1" }),
      task({ id: "t2" }),
      task({
        id: "t3",
        deps: ["t1", "t2"],
        depReasons: { t1: "integrates t1 api", t2: "integrates t2 telemetry" },
      }),
    ];
    const result = analyzeTopologyDeclaration(tasks);
    expect(result.edges.length).toBe(2);
    expect(result.unjustifiedEdges).toEqual([]);
    expect(result.independentRoots).toEqual(["t1", "t2"]);
  });
});

describe("dependency map extraction", () => {
  test("dependencyData filters strictly to task nodes and depends_on edges", () => {
    const nodes = [
      { id: "task-a", type: "task" },
      { id: "task-b", type: "task" },
      { id: "artifact-c", type: "artifact" },
    ];
    const edges = [
      { source: "task-b", target: "task-a", type: "depends_on" },
      { source: "task-b", target: "artifact-c", type: "produces" },
    ];
    const { dependencies, issues } = dependencyData(nodes, edges);
    expect(issues).toEqual([]);
    expect(dependencies.size).toBe(2);
    expect(Array.from(dependencies.get("task-a") ?? [])).toEqual([]);
    expect(Array.from(dependencies.get("task-b") ?? [])).toEqual(["task-a"]);
  });

  test("dependencyData detects invalid edges and self loops", () => {
    const nodes = [
      { id: "task-a", type: "task" },
      { id: "task-b", type: "task" },
    ];
    const edges = [
      { source: "task-a", target: "task-a", type: "depends_on" },
      { source: "task-b", target: "task-c", type: "depends_on" },
    ];
    const { issues } = dependencyData(nodes, edges);
    expect(issues.length).toBe(2);
  });

  test("dependencyMap parses full graph document", () => {
    const graph = {
      schema: "harness.graph",
      version: 1,
      revision: 1,
      nodes: [
        { id: "t1", type: "task" },
        { id: "t2", type: "task" },
      ],
      edges: [{ source: "t2", target: "t1", type: "depends_on" }],
      gates: [],
    };
    const map = dependencyMap(graph);
    expect(map.size).toBe(2);
    expect(Array.from(map.get("t2") ?? [])).toEqual(["t1"]);
  });

  test("downstreamMap inverts prerequisite dependencies into forward downstream references", () => {
    const dependencies: DependencyMap = new Map([
      ["a", new Set([])],
      ["b", new Set(["a"])],
      ["c", new Set(["a"])],
      ["d", new Set(["b", "c"])],
    ]);
    const downstream = downstreamMap(dependencies);
    expect(Array.from(downstream.get("a") ?? []).sort()).toEqual(["b", "c"]);
    expect(Array.from(downstream.get("b") ?? [])).toEqual(["d"]);
    expect(Array.from(downstream.get("c") ?? [])).toEqual(["d"]);
    expect(Array.from(downstream.get("d") ?? [])).toEqual([]);
  });
});

describe("topological ordering and cycle diagnostics", () => {
  test("computes linear topological order", () => {
    const dependencies: DependencyMap = new Map([
      ["step-1", new Set([])],
      ["step-2", new Set(["step-1"])],
      ["step-3", new Set(["step-2"])],
    ]);
    const order = topologicalOrder(dependencies);
    expect(order).toEqual(["step-1", "step-2", "step-3"]);
  });

  test("computes topological order across multiple independent roots and branches", () => {
    const dependencies: DependencyMap = new Map([
      ["root-2", new Set([])],
      ["root-1", new Set([])],
      ["branch-a", new Set(["root-1"])],
      ["branch-b", new Set(["root-2"])],
      ["sink", new Set(["branch-a", "branch-b"])],
    ]);
    const order = topologicalOrder(dependencies);
    expect(order.indexOf("root-1")).toBeLessThan(order.indexOf("branch-a"));
    expect(order.indexOf("root-2")).toBeLessThan(order.indexOf("branch-b"));
    expect(order.indexOf("branch-a")).toBeLessThan(order.indexOf("sink"));
    expect(order.indexOf("branch-b")).toBeLessThan(order.indexOf("sink"));
    expect(order[order.length - 1]).toBe("sink");
  });

  test("describeCycle reports cycle when dependencies form a loop", () => {
    const dependencies: DependencyMap = new Map([
      ["task-1", new Set(["task-2"])],
      ["task-2", new Set(["task-1"])],
    ]);
    const desc = describeCycle(dependencies);
    expect(desc).toContain("task-1");
    expect(desc).toContain("task-2");
  });

  test("handles empty dependency map gracefully", () => {
    const order = topologicalOrder(new Map());
    expect(order).toEqual([]);
  });
});
