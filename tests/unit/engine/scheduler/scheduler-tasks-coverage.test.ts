import { describe, expect, it } from "bun:test";
import { probeGateCoverageViolations } from "../../../../olt/scripts/src/engine/scheduler/core/tasks/tasks-coverage.ts";

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
            command: "bun test tests/unit/a.test.ts",
            cwd: "tests/unit",
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
        null, // not an object
        {
          id: "invalid id with spaces!",
          scope: "task",
          command: "bun test",
          requirement_ids: ["req-1"],
        },
        {
          id: "gate-empty-cmd",
          scope: "task",
          command: "", // empty command
          requirement_ids: ["req-1"],
        },
        {
          id: "gate-noop-cmd",
          scope: "task",
          command: "echo", // weak noop command
          requirement_ids: ["req-1"],
        },
        {
          id: "gate-bad-cwd",
          scope: "task",
          command: "bun test",
          cwd: "/absolute/path/forbidden", // absolute cwd forbidden
          requirement_ids: ["req-1"],
        },
        {
          id: "gate-bad-scope",
          scope: "invalid_scope", // must be 'task' or 'run'
          command: "bun test",
        },
        {
          id: "gate-empty-task-reqs",
          scope: "task",
          command: "bun test",
          requirement_ids: [], // empty requirement_ids
        },
        {
          id: "gate-run-with-reqs",
          scope: "run",
          command: "bun test",
          requirement_ids: ["req-1"], // run gate must not have requirement_ids
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
    expect(result.invalidGates.some((g) => g.includes("not a normalized relative path"))).toBe(true);
    expect(result.invalidGates.some((g) => g.includes("invalid scope"))).toBe(true);
    expect(result.invalidGates.some((g) => g.includes("empty requirement_ids"))).toBe(true);
    expect(result.invalidGates.some((g) => g.includes("Run gate 'gate-run-with-reqs' must not have requirement_ids"))).toBe(true);
  });

  it("detects tasks without gate coverage", () => {
    const state = {
      gates: [
        {
          id: "gate-1",
          scope: "task",
          command: "bun test",
          requirement_ids: ["req-covered"],
        },
      ],
      tasks: {
        t1: {
          id: "t1",
          requirement_ids: ["req-covered", "req-missing-gate"],
        },
        t2: {
          id: "t2",
          requirement_ids: ["req-missing-gate"],
        },
        tNull: null,
      },
    };

    const result = probeGateCoverageViolations(state);
    expect(result.passed).toBe(false);
    expect(result.uncoveredRequirementIds).toEqual(["req-missing-gate"]);
    expect(result.tasksWithoutGateCoverage).toEqual(["t1", "t2"]);
    expect(result.details.length).toBe(2);
    expect(result.details[0]).toContain("Task 't1' requirement 'req-missing-gate' is not covered");
  });
});
