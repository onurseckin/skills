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
