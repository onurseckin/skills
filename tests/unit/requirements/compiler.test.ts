import { describe, expect, test } from "bun:test";
import { compileRequirementsFromPrompt } from "../../../orchestrating-long-tasks/scripts/src/requirements/compiler.ts";
import { compileGraphDocument } from "../../../orchestrating-long-tasks/scripts/src/graph/compiler.ts";

describe("Requirements and Graph Compilers", () => {
  test("compileRequirementsFromPrompt generates valid requirements covering all lines", () => {
    const prompt = "Line one requirement\n\nLine three context\nLine four details";
    const tasks = [
      {
        id: "task-1",
        label: "Task 1",
        writeScope: ["src/feature1"],
        gate: "bun test tests/unit/feature1",
        goal: "Implement feature 1",
        criteria: ["Criteria 1", "Criteria 2"],
      },
      {
        id: "task-2",
        label: "Task 2",
        writeScope: ["src/feature2"],
        gate: ["bun", "test", "tests/unit/feature2"],
        deps: ["task-1"],
      },
    ];

    const result = compileRequirementsFromPrompt(prompt, tasks);
    expect(result.atomicRequirements).toHaveLength(2);
    expect(result.requirementsDocument.schema).toBe("harness.requirements");
    expect(result.requirementsDocument.version).toBe(1);

    const reqs = result.requirementsDocument.requirements as Record<string, unknown>[];
    expect(reqs[0]!.id).toBe("req-1");
    expect(reqs[1]!.id).toBe("req-2");

    const disps = result.requirementsDocument.dispositions as Record<string, unknown>[];
    expect(disps.length).toBe(3); // 3 non-blank lines in prompt
  });

  test("compileRequirementsFromPrompt throws on empty prompt", () => {
    expect(() =>
      compileRequirementsFromPrompt("\n  \n", [
        { id: "t1", label: "T1", writeScope: ["a"], gate: "g" },
      ]),
    ).toThrow("prompt must contain at least one non-blank line");
  });

  test("compileGraphDocument compiles a valid graph matching requirements", () => {
    const prompt = "Goal 1\n\nGoal 2";
    const tasks = [
      { id: "task-1", label: "Task 1", writeScope: ["src/a"], gate: "bun test tests/a" },
      {
        id: "task-2",
        label: "Task 2",
        writeScope: ["src/b"],
        gate: "bun test tests/b",
        deps: ["task-1"],
      },
    ];

    const reqResult = compileRequirementsFromPrompt(prompt, tasks);
    const graphResult = compileGraphDocument(
      tasks,
      reqResult.requirementsDocument,
      reqResult.requirementIdsByTask,
      1,
      ["bun", "test", "tests"],
    );

    expect(graphResult.graphDocument.schema).toBe("harness.graph");
    expect(graphResult.graphDocument.revision).toBe(1);

    const nodes = graphResult.graphDocument.nodes as Record<string, unknown>[];
    const taskNodes = nodes.filter((n) => n.type === "task");
    expect(taskNodes).toHaveLength(2);
    expect(taskNodes[0]!.status).toBe("ready");
    expect(taskNodes[1]!.status).toBe("proposed");

    const gates = graphResult.graphDocument.gates as Record<string, unknown>[];
    expect(gates.some((g) => g.scope === "run" && g.mandatory === true)).toBe(true);
    expect(gates.some((g) => g.scope === "task" && g.id === "gate-1")).toBe(true);
  });
});
