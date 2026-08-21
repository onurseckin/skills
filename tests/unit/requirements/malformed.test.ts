import { describe, expect, test } from "bun:test";
import { validateRequirements } from "../../../orchestrating-long-tasks/scripts/src/requirements/validate-requirements.ts";
import { requirementsDocument } from "./fixtures.ts";

describe("malformed requirement documents", () => {
  test("invalid and duplicate requirement and acceptance IDs are rejected", () => {
    const prompt = "First\n\nThird";
    const valid = requirementsDocument(prompt);
    const variants = Array.from({ length: 4 }, () => structuredClone(valid));
    (variants[0]!.requirements as Record<string, unknown>[])[0]!.id = "requirement one";
    (variants[1]!.requirements as Record<string, unknown>[])[1]!.id = "R-001";
    const firstAcceptance = (variants[2]!.requirements as Record<string, unknown>[])[0]!
      .acceptance as Record<string, unknown>[];
    firstAcceptance[0]!.id = "bad id";
    const duplicateAcceptance = (variants[3]!.requirements as Record<string, unknown>[])[0]!
      .acceptance as unknown[];
    duplicateAcceptance.push(structuredClone(duplicateAcceptance[0]));
    for (const document of variants) expect(validateRequirements(prompt, document)).not.toEqual([]);
  });

  test("malformed requirement types and boolean integers are rejected", () => {
    const prompt = "Build it";
    const valid = requirementsDocument(prompt);
    for (const [key, value] of [
      ["version", true],
      ["requirements", {}],
      ["dispositions", "all"],
    ] as const) {
      const document = structuredClone(valid);
      document[key] = value;
      expect(validateRequirements(prompt, document)).not.toEqual([]);
    }
    const sourceLine = structuredClone(valid);
    (sourceLine.requirements as Record<string, unknown>[])[0]!.source_lines = [true];
    expect(validateRequirements(prompt, sourceLine)).not.toEqual([]);
    expect(validateRequirements(3, valid)).not.toEqual([]);
    expect(validateRequirements(prompt, [])).not.toEqual([]);
  });

  test("source_lines rejects a missing list, a duplicate line, and a blank line", () => {
    const prompt = "First\n\nThird";
    const valid = requirementsDocument(prompt);

    const missing = structuredClone(valid);
    delete (missing.requirements as Record<string, unknown>[])[0]!.source_lines;
    expect(validateRequirements(prompt, missing)).toContain(
      "requirements[0].source_lines must be a non-empty list",
    );

    const empty = structuredClone(valid);
    (empty.requirements as Record<string, unknown>[])[0]!.source_lines = [];
    expect(validateRequirements(prompt, empty)).toContain(
      "requirements[0].source_lines must be a non-empty list",
    );

    const duplicate = structuredClone(valid);
    (duplicate.requirements as Record<string, unknown>[])[0]!.source_lines = [1, 1];
    expect(validateRequirements(prompt, duplicate)).toContain(
      "requirements[0].source_lines contains duplicate line 1",
    );

    // Line 2 of "First\n\nThird" is blank; a requirement cannot bind to it.
    const blank = structuredClone(valid);
    (blank.requirements as Record<string, unknown>[])[0]!.source_lines = [2];
    expect(validateRequirements(prompt, blank)).toContain(
      "requirements[0].source_lines references blank line 2",
    );
  });

  test("candidate_gates rejects a non-object entry and an empty argv", () => {
    const prompt = "Build it";
    const valid = requirementsDocument(prompt);

    const nonObject = structuredClone(valid);
    (nonObject.requirements as Record<string, unknown>[])[0]!.candidate_gates = ["not-an-object"];
    expect(validateRequirements(prompt, nonObject)).toContain(
      "requirements[0].candidate_gates[0] must be an object",
    );

    const emptyArgv = structuredClone(valid);
    (emptyArgv.requirements as Record<string, unknown>[])[0]!.candidate_gates = [
      { argv: [], cwd: "." },
    ];
    expect(validateRequirements(prompt, emptyArgv)).toContain(
      "requirements[0].candidate_gates[0].argv must be a non-empty string list",
    );
  });

  test("a disposition's requirement_ids must be a non-empty list, and cannot repeat an id", () => {
    const prompt = "First\n\nThird";
    const valid = requirementsDocument(prompt);

    const emptyList = structuredClone(valid);
    (emptyList.dispositions as Record<string, unknown>[])[0]!.requirement_ids = [];
    delete (emptyList.dispositions as Record<string, unknown>[])[0]!.requirement_id;
    expect(validateRequirements(prompt, emptyList)).toContain(
      "dispositions[0].requirement_ids must be a non-empty list",
    );

    const repeated = structuredClone(valid);
    delete (repeated.dispositions as Record<string, unknown>[])[0]!.requirement_id;
    (repeated.dispositions as Record<string, unknown>[])[0]!.requirement_ids = ["R-001", "R-001"];
    expect(validateRequirements(prompt, repeated)).toContain(
      "dispositions[0] repeats requirement R-001",
    );
  });

  test("unhashable nested requirement values return issues", () => {
    const prompt = "Build it";
    const valid = requirementsDocument(prompt);
    for (const [field, value] of [
      ["kind", ["requirement"]],
      ["requirement_id", { id: "R-001" }],
    ] as const) {
      const document = structuredClone(valid);
      (document.dispositions as Record<string, unknown>[])[0]![field] = value;
      expect(() => validateRequirements(prompt, document)).not.toThrow();
      expect(validateRequirements(prompt, document)).not.toEqual([]);
    }
  });
});
