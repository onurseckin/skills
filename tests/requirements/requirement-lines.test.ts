import { describe, expect, test } from "bun:test";
import { compileRequirementsFromPrompt } from "../../olt/scripts/src/requirements/compiler.ts";
import { parseRequirementLines } from "../../olt/scripts/src/requirements/requirement-lines.ts";

const PROMPT = [
  "Build the drawer",
  "",
  "Wire the store",
  "Render the tabs",
  "Ship the fixture",
].join("\n");

function task(
  id: string,
  lines?: readonly number[],
): {
  id: string;
  label: string;
  writeScope: string[];
  gate: string;
  requirementLines?: readonly number[];
} {
  return {
    id,
    label: `Label ${id}`,
    writeScope: [`src/${id}`],
    gate: `bun test tests/${id}`,
    ...(lines === undefined ? {} : { requirementLines: lines }),
  };
}

describe("--requirement-lines parsing", () => {
  test("expands ranges and singles into ascending unique lines", () => {
    expect(parseRequirementLines("3-5,1", PROMPT)).toEqual([1, 3, 4, 5]);
    expect(parseRequirementLines(" 4 ", PROMPT)).toEqual([4]);
    expect(parseRequirementLines("3-3", PROMPT)).toEqual([3]);
  });

  test("rejects malformed, descending, out-of-range and blank-line references", () => {
    expect(() => parseRequirementLines("three", PROMPT)).toThrow(
      'expects line numbers or ranges like "3-5", got "three"',
    );
    expect(() => parseRequirementLines("5-3", PROMPT)).toThrow('range "5-3" ends before it starts');
    expect(() => parseRequirementLines("9", PROMPT)).toThrow(
      "references line 9, outside the 5-line prompt",
    );
    expect(() => parseRequirementLines("2", PROMPT)).toThrow("references blank prompt line 2");
  });

  test("rejects an oversized range without materialising it", () => {
    const before = Date.now();
    expect(() => parseRequirementLines("1-900000000", PROMPT)).toThrow(
      "references line 6, outside the 5-line prompt",
    );
    expect(Date.now() - before).toBeLessThan(1000);
  });
});

describe("prompt binding in the requirements compiler", () => {
  test("an explicitly bound task owns exactly the lines it declared", () => {
    const result = compileRequirementsFromPrompt(PROMPT, [task("task-a", [3, 4, 5])]);

    const requirements = result.requirementsDocument.requirements as Record<string, unknown>[];
    expect(requirements).toHaveLength(1);
    expect(requirements[0]!.source_lines).toEqual([3, 4, 5]);
    expect(requirements[0]!.source_excerpt).toBe(
      "Wire the store\nRender the tabs\nShip the fixture",
    );
    expect(result.warnings).toEqual([
      "task task-a's requirement req-a has no declared acceptance criteria; its own gate passing is the only proof of done, which is unfalsifiable — pass --criteria to give it real acceptance criteria",
    ]);
  });

  test("positional gluing still happens without a binding, and warns", () => {
    const result = compileRequirementsFromPrompt(PROMPT, [task("task-a"), task("task-b")]);

    const requirements = result.requirementsDocument.requirements as Record<string, unknown>[];
    expect(requirements.map((entry) => entry.source_lines)).toEqual([[1], [3]]);
    expect(result.warnings).toEqual([
      "task task-a was glued to prompt line 1 by position, not by declaration; pass --requirement-lines to bind it to the lines it actually implements",
      "task task-a's requirement req-a has no declared acceptance criteria; its own gate passing is the only proof of done, which is unfalsifiable — pass --criteria to give it real acceptance criteria",
      "task task-b was glued to prompt line 3 by position, not by declaration; pass --requirement-lines to bind it to the lines it actually implements",
      "task task-b's requirement req-b has no declared acceptance criteria; its own gate passing is the only proof of done, which is unfalsifiable — pass --criteria to give it real acceptance criteria",
    ]);
  });

  test("a declared line is reserved from the positional sweep", () => {
    const result = compileRequirementsFromPrompt(PROMPT, [task("task-a"), task("task-b", [1])]);

    const requirements = result.requirementsDocument.requirements as Record<string, unknown>[];
    expect(requirements.map((entry) => [entry.id, entry.source_lines])).toEqual([
      ["req-a", [3]],
      ["req-b", [1]],
    ]);
  });

  test("two tasks may share a line, and the disposition names both", () => {
    const result = compileRequirementsFromPrompt(PROMPT, [
      task("task-a", [3]),
      task("task-b", [3, 4]),
    ]);

    const dispositions = result.requirementsDocument.dispositions as Record<string, unknown>[];
    expect(dispositions.find((entry) => entry.line === 3)).toEqual({
      line: 3,
      kind: "requirement",
      requirement_ids: ["req-a", "req-b"],
    });
    expect(dispositions.find((entry) => entry.line === 4)).toEqual({
      line: 4,
      kind: "requirement",
      requirement_id: "req-b",
    });
    expect(dispositions.find((entry) => entry.line === 1)).toMatchObject({ kind: "context" });
  });

  test("a task with no line left to claim refuses instead of folding into an existing requirement", () => {
    expect(() =>
      compileRequirementsFromPrompt("Only one line", [task("task-a"), task("task-b")]),
    ).toThrow(
      "task task-b has no prompt line to bind to and cannot be folded into another requirement; pass --requirement-lines to bind it to the lines it actually implements",
    );
  });

  test("the fold refuses and names every unbindable task, not just the first", () => {
    expect(() =>
      compileRequirementsFromPrompt("Only one line", [
        task("task-a"),
        task("task-b"),
        task("task-c"),
        task("task-d"),
      ]),
    ).toThrow(
      "tasks task-b, task-c, task-d have no prompt line to bind to and cannot be folded into another requirement; pass --requirement-lines to bind each one to the lines it actually implements",
    );
  });

  test("a single task against a single-line prompt still compiles positionally, with a warning", () => {
    const result = compileRequirementsFromPrompt("Only one line", [task("task-a")]);

    const requirements = result.requirementsDocument.requirements as Record<string, unknown>[];
    expect(requirements).toHaveLength(1);
    expect(requirements[0]!.source_lines).toEqual([1]);
    expect(result.warnings).toEqual([
      "task task-a was glued to prompt line 1 by position, not by declaration; pass --requirement-lines to bind it to the lines it actually implements",
      "task task-a's requirement req-a has no declared acceptance criteria; its own gate passing is the only proof of done, which is unfalsifiable — pass --criteria to give it real acceptance criteria",
    ]);
  });
});

describe("gate-as-acceptance fallback in the requirements compiler", () => {
  test("a task without --criteria falls back to gate-as-acceptance, and warns loudly", () => {
    const result = compileRequirementsFromPrompt(PROMPT, [task("task-a", [1])]);

    const requirements = result.requirementsDocument.requirements as Record<string, unknown>[];
    const acceptance = requirements[0]!.acceptance as Record<string, unknown>[];
    expect(acceptance[0]!.criterion).toBe(
      "Task gate `bun test tests/task-a` passes with exit code 0",
    );
    expect(result.warnings).toEqual([
      "task task-a's requirement req-a has no declared acceptance criteria; its own gate passing is the only proof of done, which is unfalsifiable — pass --criteria to give it real acceptance criteria",
    ]);
  });

  test("--criteria suppresses the gate-as-acceptance warning", () => {
    const result = compileRequirementsFromPrompt(PROMPT, [
      {
        id: "task-a",
        label: "Label task-a",
        writeScope: ["src/task-a"],
        gate: "bun test tests/task-a",
        requirementLines: [1],
        criteria: ["The drawer opens on click"],
      },
    ]);

    expect(result.warnings).toEqual([]);
    const requirements = result.requirementsDocument.requirements as Record<string, unknown>[];
    const acceptance = requirements[0]!.acceptance as Record<string, unknown>[];
    expect(acceptance[0]!.criterion).toBe("The drawer opens on click");
  });
});
