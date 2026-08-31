import { describe, expect, it } from "bun:test";
import { probeCircularDependencies } from "../../../olt/scripts/src/engine/scheduler/core/tasks/tasks-circular.ts";
import { probeGateCoverageViolations } from "../../../olt/scripts/src/engine/scheduler/core/tasks/tasks-coverage.ts";

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
          dependencies: ["t1"],
        },
      },
    };

    const result = probeCircularDependencies(state);
    expect(result.passed).toBe(false);
    expect(result.hasCycles).toBe(true);
    expect(result.cycleDescriptions).toContain("Task 't1' has self-dependency on itself.");
    expect(result.details).toContain("Task 't1' has self-dependency on itself.");
  });
});

describe("engine/scheduler/core/tasks/tasks-coverage.ts", () => {
  it("returns default passed result when state is not a record", () => {
    const resultNull = probeGateCoverageViolations(null);
    expect(resultNull.passed).toBe(true);
    expect(resultNull.uncoveredRequirementIds).toEqual([]);
    expect(resultNull.tasksWithoutGateCoverage).toEqual([]);
    expect(resultNull.invalidGates).toEqual([]);
    expect(resultNull.hasMandatoryRunGate).toBe(false);
    expect(resultNull.details).toEqual([]);
  });

  it("passes when all task requirements are covered by valid task gates", () => {
    const state = {
      graph: {
        gates: [
          {
            id: "gate-task-1",
            scope: "task",
            command: "bun test tests/engine/policy/policy-engine.test.ts",
            cwd: "tests/engine",
            requirement_ids: ["req-1", "req-2"],
          },
        ],
      },
      tasks: {
        t1: {
          id: "t1",
          requirement_ids: ["req-1"],
        },
        t2: {
          id: "t2",
          requirement_ids: ["req-2"],
        },
      },
    };

    const result = probeGateCoverageViolations(state);
    expect(result.passed).toBe(true);
    expect(result.invalidGates).toEqual([]);
    expect(result.uncoveredRequirementIds).toEqual([]);
    expect(result.tasksWithoutGateCoverage).toEqual([]);
  });

  it("passes all task requirements when a mandatory run gate is present", () => {
    const state = {
      gates: [
        {
          id: "gate-run-all",
          scope: "run",
          command: ["bun", "test"],
          mandatory: true,
        },
      ],
      tasks: {
        t1: {
          id: "t1",
          requirement_ids: ["req-uncovered-by-task-gate"],
        },
      },
    };

    const result = probeGateCoverageViolations(state);
    expect(result.passed).toBe(true);
    expect(result.hasMandatoryRunGate).toBe(true);
    expect(result.uncoveredRequirementIds).toEqual([]);
    expect(result.tasksWithoutGateCoverage).toEqual([]);
  });

  it("detects invalid gates: non-object, invalid identifier, empty cmd, noop cmd, invalid cwd, invalid scope", () => {
    const state = {
      gates: [
        null,
        {
          id: "invalid id with spaces!",
          scope: "task",
          command: "bun test",
          requirement_ids: ["req-1"],
        },
        {
          id: "gate-empty-cmd",
          scope: "task",
          command: "",
          requirement_ids: ["req-1"],
        },
        {
          id: "gate-noop-cmd",
          scope: "task",
          command: "echo",
          requirement_ids: ["req-1"],
        },
        {
          id: "gate-bad-cwd",
          scope: "task",
          command: "bun test",
          cwd: "/absolute/path/forbidden",
          requirement_ids: ["req-1"],
        },
        {
          id: "gate-bad-scope",
          scope: "invalid_scope",
          command: "bun test",
        },
        {
          id: "gate-empty-task-reqs",
          scope: "task",
          command: "bun test",
          requirement_ids: [],
        },
        {
          id: "gate-run-with-reqs",
          scope: "run",
          command: "bun test",
          requirement_ids: ["req-1"],
        },
      ],
      tasks: {},
    };

    const result = probeGateCoverageViolations(state);
    expect(result.passed).toBe(false);
    expect(result.invalidGates.length).toBe(8);
    expect(result.invalidGates.some((g) => g.includes("is not an object"))).toBe(true);
    expect(result.invalidGates.some((g) => g.includes("invalid identifier"))).toBe(true);
    expect(result.invalidGates.some((g) => g.includes("empty or non-blank command"))).toBe(true);
    expect(result.invalidGates.some((g) => g.includes("weak non-substantive command"))).toBe(true);
  });
});
