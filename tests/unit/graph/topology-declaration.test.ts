import { describe, expect, test } from "bun:test";
import {
  analyzeTopologyDeclaration,
  assertTopologyJustified,
} from "../../../orchestrating-long-tasks/scripts/src/graph/topology-declaration.ts";
import type { TaskDeclaration } from "../../../orchestrating-long-tasks/scripts/src/requirements/compiler.ts";

function task(overrides: Partial<TaskDeclaration> & Pick<TaskDeclaration, "id">): TaskDeclaration {
  return {
    label: overrides.id,
    writeScope: [`src/${overrides.id}`],
    gate: `bun test src/${overrides.id}`,
    ...overrides,
  };
}

describe("analyzeTopologyDeclaration", () => {
  test("counts every task with no deps as an independent root", () => {
    const result = analyzeTopologyDeclaration([
      task({ id: "a" }),
      task({ id: "b" }),
      task({ id: "c", deps: ["a"], depReasons: { a: "reads what a writes" } }),
    ]);
    expect(result.independentRoots).toEqual(["a", "b"]);
    expect(result.totalTasks).toBe(3);
  });

  test("an edge with a non-blank --dep-reason is justified", () => {
    const result = analyzeTopologyDeclaration([
      task({ id: "a" }),
      task({ id: "b", deps: ["a"], depReasons: { a: "b consumes the port types a declares" } }),
    ]);
    expect(result.edges).toEqual([
      { task: "b", dependsOn: "a", justification: "b consumes the port types a declares" },
    ]);
    expect(result.unjustifiedEdges).toEqual([]);
  });

  test("a declared dep with no matching reason is unjustified", () => {
    const result = analyzeTopologyDeclaration([task({ id: "a" }), task({ id: "b", deps: ["a"] })]);
    expect(result.unjustifiedEdges).toEqual([{ task: "b", dependsOn: "a" }]);
    expect(result.edges).toEqual([]);
  });

  test("a whitespace-only reason does not count as a justification", () => {
    const result = analyzeTopologyDeclaration([
      task({ id: "a" }),
      task({ id: "b", deps: ["a"], depReasons: { a: "   " } }),
    ]);
    expect(result.unjustifiedEdges).toEqual([{ task: "b", dependsOn: "a" }]);
  });

  test("justification text is trimmed before it is recorded", () => {
    const result = analyzeTopologyDeclaration([
      task({ id: "a" }),
      task({ id: "b", deps: ["a"], depReasons: { a: "  needs a's schema  " } }),
    ]);
    expect(result.edges[0]!.justification).toBe("needs a's schema");
  });

  test("a task with multiple deps reports one edge per dependency", () => {
    const result = analyzeTopologyDeclaration([
      task({ id: "a" }),
      task({ id: "b" }),
      task({
        id: "c",
        deps: ["a", "b"],
        depReasons: { a: "reads a's output", b: "reads b's output" },
      }),
    ]);
    expect(result.edges.map((e) => e.dependsOn).sort()).toEqual(["a", "b"]);
    expect(result.unjustifiedEdges).toEqual([]);
  });
});

describe("assertTopologyJustified", () => {
  test("does not throw when every edge is justified", () => {
    const result = analyzeTopologyDeclaration([
      task({ id: "a" }),
      task({ id: "b", deps: ["a"], depReasons: { a: "reads a" } }),
    ]);
    expect(() => assertTopologyJustified(result)).not.toThrow();
  });

  test("refuses with every unjustified edge named, not just the first", () => {
    const result = analyzeTopologyDeclaration([
      task({ id: "a" }),
      task({ id: "b" }),
      task({ id: "c", deps: ["a", "b"] }),
    ]);
    expect(() => assertTopologyJustified(result)).toThrow(
      "dependency edge(s) without a declared justification: c -> a, c -> b",
    );
  });
});
