import { describe, expect, test } from "bun:test";
import { computeExecutionSteps } from "../../../orchestrating-long-tasks/scripts/src/summary/step-calculator.ts";
import type { TaskRecord } from "../../../orchestrating-long-tasks/scripts/src/workflow/types.ts";

function createTask(id: string, dependencies: string[] = []): TaskRecord {
  return {
    id,
    label: `Task ${id}`,
    status: "ready",
    requirement_ids: [],
    write_scope: [],
    dependencies,
    attempts: [],
    history: [],
    repair_round: 0,
  };
}

describe("step calculator", () => {
  test("assigns steps correctly for linear pipeline", () => {
    const tasks = [createTask("T-1", []), createTask("T-2", ["T-1"]), createTask("T-3", ["T-2"])];

    const result = computeExecutionSteps(tasks);
    expect(result.taskSteps.get("T-1")).toBe(2);
    expect(result.taskWaves.get("T-1")).toBe(1);

    expect(result.taskSteps.get("T-2")).toBe(4);
    expect(result.taskWaves.get("T-2")).toBe(2);

    expect(result.taskSteps.get("T-3")).toBe(6);
    expect(result.taskWaves.get("T-3")).toBe(3);

    expect(result.criticStep).toBe(8);
    expect(result.terminalStep).toBe(9);
  });

  test("assigns concurrent tasks in same wave to same step", () => {
    const tasks = [createTask("T-A", []), createTask("T-B", []), createTask("T-C", ["T-A", "T-B"])];

    const result = computeExecutionSteps(tasks);
    expect(result.taskSteps.get("T-A")).toBe(2);
    expect(result.taskSteps.get("T-B")).toBe(2);
    expect(result.taskWaves.get("T-A")).toBe(1);
    expect(result.taskWaves.get("T-B")).toBe(1);

    expect(result.taskSteps.get("T-C")).toBe(4);
    expect(result.taskWaves.get("T-C")).toBe(2);
  });

  test("handles empty tasks list", () => {
    const result = computeExecutionSteps([]);
    expect(result.taskSteps.size).toBe(0);
    expect(result.criticStep).toBe(4);
    expect(result.terminalStep).toBe(5);
  });
});
