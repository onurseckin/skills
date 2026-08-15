import { describe, expect, test } from "bun:test";
import {
  analyzeScopeIndependence,
  checkScopeOverlap,
  computeConcurrencyWaves,
  normalizeScopePath,
} from "../../../orchestrating-long-tasks/scripts/src/graph/scope-analyzer.ts";

describe("Scope Independence Analyzer", () => {
  test("normalizeScopePath strips leading ./, trailing /, and backslashes", () => {
    expect(normalizeScopePath("./src/cli/")).toBe("src/cli");
    expect(normalizeScopePath("src\\graph\\")).toBe("src/graph");
    expect(normalizeScopePath("///")).toBe("/");
    expect(normalizeScopePath("tests/unit/")).toBe("tests/unit");
  });

  test("checkScopeOverlap detects exact match and parent-child overlaps", () => {
    expect(checkScopeOverlap(["src/cli"], ["src/cli"])).toEqual({
      hasOverlap: true,
      conflictingPath: "src/cli",
      relation: "exact_match",
    });

    expect(checkScopeOverlap(["src"], ["src/cli"])).toEqual({
      hasOverlap: true,
      conflictingPath: "src/cli",
      relation: "parent_child",
    });

    expect(checkScopeOverlap(["src/cli"], ["src"])).toEqual({
      hasOverlap: true,
      conflictingPath: "src/cli",
      relation: "parent_child",
    });

    expect(checkScopeOverlap(["src/cli"], ["src/graph"])).toEqual({
      hasOverlap: false,
      conflictingPath: "",
      relation: "none",
    });
  });

  test("computeConcurrencyWaves calculates topological waves correctly", () => {
    const tasks = [
      { taskId: "t1", writeScope: ["src/a"], dependencies: [] },
      { taskId: "t2", writeScope: ["src/b"], dependencies: [] },
      { taskId: "t3", writeScope: ["src/c"], dependencies: ["t1", "t2"] },
      { taskId: "t4", writeScope: ["src/d"], dependencies: ["t3"] },
    ];
    const depsMap = new Map([
      ["t1", new Set<string>()],
      ["t2", new Set<string>()],
      ["t3", new Set(["t1", "t2"])],
      ["t4", new Set(["t3"])],
    ]);

    const waves = computeConcurrencyWaves(tasks, depsMap);
    expect(waves).toHaveLength(3);
    expect(waves[0]!.tasks.sort()).toEqual(["t1", "t2"]);
    expect(waves[1]!.tasks).toEqual(["t3"]);
    expect(waves[2]!.tasks).toEqual(["t4"]);
  });

  test("computeConcurrencyWaves handles cyclic dependencies safely", () => {
    const tasks = [
      { taskId: "t1", writeScope: ["src/a"], dependencies: ["t2"] },
      { taskId: "t2", writeScope: ["src/b"], dependencies: ["t1"] },
    ];
    const depsMap = new Map([
      ["t1", new Set(["t2"])],
      ["t2", new Set(["t1"])],
    ]);

    const waves = computeConcurrencyWaves(tasks, depsMap);
    expect(waves.length).toBeGreaterThan(0);
  });

  test("analyzeScopeIndependence detects collisions and emits warnings", () => {
    const tasks = [
      { taskId: "t1", writeScope: ["src/shared"], dependencies: [] },
      { taskId: "t2", writeScope: ["src/shared/sub"], dependencies: [] },
      { taskId: "t3", writeScope: ["src/isolated"], dependencies: ["t1"] },
    ];

    const result = analyzeScopeIndependence(tasks);
    expect(result.collisions).toHaveLength(1);
    expect(result.collisions[0]!.taskA).toBe("t1");
    expect(result.collisions[0]!.taskB).toBe("t2");
    expect(result.collisions[0]!.relation).toBe("parent_child");

    expect(result.serializationWarnings).toHaveLength(1);
    expect(result.serializationWarnings[0]!.blockedTask).toBe("t3");
    expect(result.serializationWarnings[0]!.dependencyTask).toBe("t1");
  });

  test("analyzeScopeIndependence returns 0 collisions for disjoint tasks", () => {
    const tasks = [
      { taskId: "task-core", writeScope: ["tests/unit/core"], dependencies: [] },
      { taskId: "task-cli", writeScope: ["tests/unit/cli"], dependencies: [] },
      { taskId: "task-graph", writeScope: ["tests/unit/graph"], dependencies: [] },
    ];

    const result = analyzeScopeIndependence(tasks);
    expect(result.collisions).toHaveLength(0);
    expect(result.concurrencyWaves).toHaveLength(1);
    expect(result.concurrencyWaves[0]!.tasks.length).toBe(3);
  });
});
