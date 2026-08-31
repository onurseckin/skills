import { describe, expect, test } from "bun:test";
import {
  dependencyData,
  describeCycle,
  downstreamMap,
  topologicalOrder,
} from "../../../olt/scripts/src/graph/topology.ts";
import { validateTaskQueueDag } from "../../../olt/scripts/src/task/queue/enqueue.ts";
import type { TaskQueueItem } from "../../../olt/scripts/src/task/queue/types.ts";

describe("Kahn Topological Sorter", () => {
  test("returns empty array for empty dependency map", () => {
    expect(topologicalOrder(new Map())).toEqual([]);
  });

  test("sorts single-node graph", () => {
    const deps = new Map([["task-1", new Set<string>()]]);
    expect(topologicalOrder(deps)).toEqual(["task-1"]);
  });

  test("sorts linear chain in exact prerequisite order", () => {
    const deps = new Map([
      ["t1", new Set<string>()],
      ["t2", new Set(["t1"])],
      ["t3", new Set(["t2"])],
      ["t4", new Set(["t3"])],
    ]);
    expect(topologicalOrder(deps)).toEqual(["t1", "t2", "t3", "t4"]);
  });

  test("sorts diamond dependency graph with deterministic lexicographic order", () => {
    const deps = new Map([
      ["root", new Set<string>()],
      ["branch-b", new Set(["root"])],
      ["branch-a", new Set(["root"])],
      ["join", new Set(["branch-a", "branch-b"])],
    ]);
    expect(topologicalOrder(deps)).toEqual(["root", "branch-a", "branch-b", "join"]);
  });

  test("sorts multi-root multi-leaf forest with lexicographical tie-breaking", () => {
    const deps = new Map([
      ["z-root", new Set<string>()],
      ["a-root", new Set<string>()],
      ["m-root", new Set<string>()],
      ["child-z", new Set(["z-root"])],
      ["child-a", new Set(["a-root"])],
    ]);
    expect(topologicalOrder(deps)).toEqual(["a-root", "child-a", "m-root", "z-root", "child-z"]);
  });

  test("sorts complex multi-layer DAG with multiple prerequisites and dependents", () => {
    const deps = new Map([
      ["init", new Set<string>()],
      ["lexer", new Set(["init"])],
      ["parser", new Set(["lexer"])],
      ["typecheck", new Set(["parser"])],
      ["linter", new Set(["init"])],
      ["bundle", new Set(["typecheck", "linter"])],
    ]);
    const order = topologicalOrder(deps);
    expect(order.indexOf("init")).toBeLessThan(order.indexOf("lexer"));
    expect(order.indexOf("init")).toBeLessThan(order.indexOf("linter"));
    expect(order.indexOf("lexer")).toBeLessThan(order.indexOf("parser"));
    expect(order.indexOf("parser")).toBeLessThan(order.indexOf("typecheck"));
    expect(order.indexOf("typecheck")).toBeLessThan(order.indexOf("bundle"));
    expect(order.indexOf("linter")).toBeLessThan(order.indexOf("bundle"));
  });

  test("omits cyclic nodes when graph contains a cycle", () => {
    const cyclicDeps = new Map([
      ["node-a", new Set(["node-b"])],
      ["node-b", new Set(["node-a"])],
      ["independent", new Set<string>()],
    ]);
    const order = topologicalOrder(cyclicDeps);
    expect(order).toEqual(["independent"]);
  });
});

describe("Cycle Detection & Feedback Arc Cutting", () => {
  test("reports no cycle detected for acyclic graphs", () => {
    const acyclic = new Map([
      ["a", new Set<string>()],
      ["b", new Set(["a"])],
      ["c", new Set(["b"])],
    ]);
    expect(describeCycle(acyclic)).toBe("no cycle detected");
  });

  test("identifies two-node direct circular dependency and suggests cut", () => {
    const cycle = new Map([
      ["task-1", new Set(["task-2"])],
      ["task-2", new Set(["task-1"])],
    ]);
    const desc = describeCycle(cycle);
    expect(desc).toContain("task-1 --deps task-2 and task-2 --deps task-1 form a cycle");
    expect(desc).toContain("drop task-1 --deps task-2 to break it");
  });

  test("identifies three-node transitive cycle and names participating edges", () => {
    const cycle = new Map([
      ["a", new Set(["b"])],
      ["b", new Set(["c"])],
      ["c", new Set(["a"])],
    ]);
    const desc = describeCycle(cycle);
    expect(desc).toContain("form a cycle; drop");
    expect(desc).toContain("a --deps b");
    expect(desc).toContain("b --deps c");
    expect(desc).toContain("c --deps a");
  });

  test("isolates cyclic nodes from non-cyclic blocked downstream nodes", () => {
    const deps = new Map([
      ["c1", new Set(["c2"])],
      ["c2", new Set(["c1"])],
      ["blocked", new Set(["c1"])],
      ["valid-root", new Set<string>()],
    ]);
    const desc = describeCycle(deps);
    expect(desc).toContain("c1 --deps c2 and c2 --deps c1 form a cycle");
    expect(desc.includes("blocked")).toBe(false);
  });
});

describe("Dependency Data & Downstream Mapping", () => {
  test("collects valid depends_on edges from nodes and edge descriptors", () => {
    const nodes = [
      { id: "t1", type: "task" },
      { id: "t2", type: "task" },
      { id: "doc1", type: "artifact" },
    ];
    const edges = [
      { source: "t2", target: "t1", type: "depends_on" },
      { source: "t2", target: "doc1", type: "references" },
    ];
    const { dependencies, issues } = dependencyData(nodes, edges);
    expect(issues).toEqual([]);
    expect(dependencies.get("t2")).toEqual(new Set(["t1"]));
    expect(dependencies.get("t1")).toEqual(new Set());
  });

  test("reports issues for self-dependencies, dangling edges, and cycles", () => {
    const nodes = [
      { id: "t1", type: "task" },
      { id: "t2", type: "task" },
    ];
    const edges = [
      { source: "t1", target: "t1", type: "depends_on" },
      { source: "t1", target: "nonexistent", type: "depends_on" },
      { source: "t1", target: "t2", type: "depends_on" },
      { source: "t2", target: "t1", type: "depends_on" },
    ];
    const { issues } = dependencyData(nodes, edges);
    expect(issues.some((i) => i.includes("cannot depend on itself"))).toBe(true);
    expect(issues.some((i) => i.includes("must connect two tasks"))).toBe(true);
    expect(issues.some((i) => i.includes("form a cycle"))).toBe(true);
  });

  test("inverts dependencies into downstream adjacency map", () => {
    const deps = new Map([
      ["root", new Set<string>()],
      ["child-1", new Set(["root"])],
      ["child-2", new Set(["root"])],
      ["leaf", new Set(["child-1", "child-2"])],
    ]);
    const downstream = downstreamMap(deps);
    expect(downstream.get("root")).toEqual(new Set(["child-1", "child-2"]));
    expect(downstream.get("child-1")).toEqual(new Set(["leaf"]));
    expect(downstream.get("child-2")).toEqual(new Set(["leaf"]));
    expect(downstream.get("leaf")).toEqual(new Set());
  });
});

describe("Task Queue DAG Validation", () => {
  function makeTask(id: string, deps: string[] = []): TaskQueueItem {
    return {
      id,
      title: id,
      description: id,
      priority: "MEDIUM",
      status: "PENDING",
      write_scope: [`src/${id}.ts`],
      gate: "bun test",
      charter_goals: ["G1"],
      acceptance_criteria: [],
      dependencies: deps,
      blocked_by: deps,
      source_type: "self_evolution",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      retry_count: 0,
      max_retries: 3,
    };
  }

  test("validates clean acyclic task queue DAG", () => {
    const tasks = [makeTask("t1"), makeTask("t2", ["t1"]), makeTask("t3", ["t2"])];
    const check = validateTaskQueueDag(tasks);
    expect(check.ok).toBe(true);
    expect(check.cycles).toEqual([]);
  });

  test("detects and extracts cyclic paths in task queue DAG", () => {
    const cyclicTasks = [makeTask("a", ["b"]), makeTask("b", ["c"]), makeTask("c", ["a"])];
    const check = validateTaskQueueDag(cyclicTasks);
    expect(check.ok).toBe(false);
    expect(check.cycles.length).toBeGreaterThan(0);
    const cycle = check.cycles[0]!;
    expect(cycle).toContain("a");
    expect(cycle).toContain("b");
    expect(cycle).toContain("c");
  });
});
