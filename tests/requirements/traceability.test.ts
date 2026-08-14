import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { validateRequirements } from "../../orchestrating-long-tasks/scripts/src/requirements/index.ts";
import { requirement, requirementsDocument } from "./fixtures.ts";

describe("requirement traceability", () => {
  test("exact excerpt and UTF-8 prompt digest are required", () => {
    const prompt = "Build café\n\nUse tests\n";
    const valid = requirementsDocument(prompt);
    expect(validateRequirements(prompt, valid)).toEqual([]);
    const digest = structuredClone(valid);
    digest.prompt_sha256 = createHash("sha256").update("Build cafe\n\nUse tests\n").digest("hex");
    expect(validateRequirements(prompt, digest)).not.toEqual([]);
    const excerpt = structuredClone(valid);
    (excerpt.requirements as Record<string, unknown>[])[0]!.source_excerpt = "Build cafe";
    expect(validateRequirements(prompt, excerpt)).not.toEqual([]);
  });

  test("every nonblank line is disposed exactly once", () => {
    const prompt = "First\n\nThird\n";
    const valid = requirementsDocument(prompt);
    expect(validateRequirements(prompt, valid)).toEqual([]);
    const variants = [
      structuredClone(valid),
      structuredClone(valid),
      structuredClone(valid),
      structuredClone(valid),
    ];
    (variants[0]!.dispositions as unknown[]).pop();
    (variants[1]!.dispositions as unknown[]).push(
      structuredClone((variants[1]!.dispositions as unknown[])[0]),
    );
    (variants[2]!.dispositions as unknown[]).push({
      line: 2,
      kind: "context",
      rationale: "Formatting",
    });
    (variants[3]!.dispositions as unknown[]).push({
      line: 99,
      kind: "context",
      rationale: "Impossible",
    });
    for (const document of variants) expect(validateRequirements(prompt, document)).not.toEqual([]);
  });

  test("one line can dispose to multiple atomic requirements without duplicate dispositions", () => {
    const prompt = "Build the API and its tests";
    const document = requirementsDocument(prompt);
    (document.requirements as Record<string, unknown>[]).push(requirement("R-002", 1, prompt));
    document.dispositions = [{ line: 1, kind: "requirement", requirement_ids: ["R-001", "R-002"] }];

    expect(validateRequirements(prompt, document)).toEqual([]);

    const ambiguousLegacy = structuredClone(document);
    ambiguousLegacy.dispositions = [{ line: 1, kind: "requirement", requirement_id: "R-001" }];
    expect(validateRequirements(prompt, ambiguousLegacy)).toContain(
      "requirement R-002 dispositions must match its source lines",
    );

    const mixedForms = structuredClone(document);
    mixedForms.dispositions = [
      {
        line: 1,
        kind: "requirement",
        requirement_id: "R-001",
        requirement_ids: ["R-001", "R-002"],
      },
    ];
    expect(validateRequirements(prompt, mixedForms)).not.toEqual([]);
  });

  test("context constraint and non-actionable lines need rationales", () => {
    const prompt = "Build it\nBackground\nConstraint\nGreeting";
    const document = requirementsDocument("Build it");
    document.prompt_sha256 = createHash("sha256").update(prompt).digest("hex");
    document.dispositions = [
      { line: 1, kind: "requirement", requirement_id: "R-001" },
      { line: 2, kind: "context", rationale: "Background only" },
      { line: 3, kind: "constraint", rationale: "Limits implementation" },
      { line: 4, kind: "non_actionable", rationale: "No work requested" },
    ];
    expect(validateRequirements(prompt, document)).toEqual([]);
    (document.dispositions as Record<string, unknown>[])[1]!.rationale = "";
    expect(validateRequirements(prompt, document)).not.toEqual([]);
  });

  test("requirement status must be exactly planned", () => {
    const prompt = "Build it";
    const valid = requirementsDocument(prompt);
    for (const value of [undefined, "satisfied", ["planned"]]) {
      const document = structuredClone(valid);
      const first = (document.requirements as Record<string, unknown>[])[0]!;
      if (value === undefined) delete first.status;
      else first.status = value;
      expect(validateRequirements(prompt, document)).not.toEqual([]);
    }
  });
});
