import { describe, expect, test } from "bun:test";
import { compileRequirementsFromPrompt } from "../../../olt/scripts/src/requirements/compiler.ts";
import { compileGraphDocument } from "../../../olt/scripts/src/graph/compiler.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";

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

  test("a task with no declared line and no positional line left refuses instead of folding", () => {
    // Only one nonblank line exists, and task-1 explicitly reserves it via --requirement-lines,
    // so when task-0 (declared first, but with no explicit line of its own) reaches for it, the
    // line is already excluded as "declared elsewhere". Folding task-0's gate into task-1's
    // requirement would manufacture an unfalsifiable requirement, so the compiler refuses instead.
    expect(() =>
      compileRequirementsFromPrompt("Only line", [
        { id: "task-0", label: "Task 0", writeScope: ["a"], gate: "g0" },
        {
          id: "task-1",
          label: "Task 1",
          writeScope: ["b"],
          gate: "g1",
          requirementLines: [1],
        },
      ]),
    ).toThrow(
      "task task-0 has no prompt line to bind to and cannot be folded into another requirement; pass --requirement-lines to bind it to the lines it actually implements",
    );
  });

  test("refuses to emit a requirement its own validator would reject", () => {
    // A blank label and no goal produce a blank `instruction` field, which validateRequirements
    // rejects; compileRequirementsFromPrompt must surface that as a failure of its own rather than
    // handing back a document nothing downstream would accept.
    expect(() =>
      compileRequirementsFromPrompt("Only line", [
        { id: "task-1", label: "", writeScope: ["a"], gate: "g" },
      ]),
    ).toThrow(/^compiled requirements failed validation: /);
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

  test("compileGraphDocument refuses to compile without a declared run-completion gate", () => {
    const prompt = "Goal 1";
    const tasks = [
      { id: "task-1", label: "Task 1", writeScope: ["src/a"], gate: "bun test tests/a" },
    ];
    const reqResult = compileRequirementsFromPrompt(prompt, tasks);
    expect(() =>
      compileGraphDocument(tasks, reqResult.requirementsDocument, reqResult.requirementIdsByTask),
    ).toThrow(HarnessError);
    expect(() =>
      compileGraphDocument(tasks, reqResult.requirementsDocument, reqResult.requirementIdsByTask),
    ).toThrow("the mandatory run-completion gate needs a declared command");
  });

  test("compileGraphDocument refuses to emit a graph its own validator would reject", () => {
    // An absolute write scope survives compileGraphDocument's own normalization unchanged (it
    // only normalizes relative path syntax), so the defensive validateGraph call at the end must
    // be the one that catches it.
    const prompt = "Goal 1";
    const tasks = [
      { id: "task-1", label: "Task 1", writeScope: ["/etc"], gate: "bun test tests/a" },
    ];
    const reqResult = compileRequirementsFromPrompt(prompt, tasks);
    expect(() =>
      compileGraphDocument(
        tasks,
        reqResult.requirementsDocument,
        reqResult.requirementIdsByTask,
        1,
        ["bun", "test", "tests"],
      ),
    ).toThrow(/^compiled graph failed validation: /);
  });
});
