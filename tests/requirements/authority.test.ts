import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { validateRequirements } from "../../olt/scripts/src/requirements/validate-requirements.ts";
import { requirement, requirementsDocument } from "./fixtures.ts";

describe("requirement authority and planning metadata", () => {
  test("requires subsystem evidence gates priority risk ambiguity dependencies and disposition", () => {
    const prompt = "Build it";
    const valid = requirementsDocument(prompt);
    expect(validateRequirements(prompt, valid)).toEqual([]);
    const fields = [
      "subsystem",
      "candidate_gates",
      "priority",
      "risk",
      "ambiguity",
      "dependencies",
      "disposition",
    ];
    for (const field of fields) {
      const candidate = structuredClone(valid);
      delete (candidate.requirements as Record<string, unknown>[])[0]![field];
      expect(validateRequirements(prompt, candidate)).not.toEqual([]);
    }
    const noEvidence = structuredClone(valid);
    delete (
      (noEvidence.requirements as Record<string, unknown>[])[0]!.acceptance as Record<
        string,
        unknown
      >[]
    )[0]!.evidence;
    expect(validateRequirements(prompt, noEvidence)).not.toEqual([]);
  });

  test("links pending-authority obligations to atomic requirements", () => {
    const prompt = "Build it\nNeeds permission";
    const document = requirementsDocument("Build it");
    document.prompt_sha256 = createHash("sha256").update(prompt).digest("hex");
    (document.requirements as Record<string, unknown>[]).push(
      Object.assign(requirement("R-002", 2, "Needs permission"), {
        disposition: "needs_authority",
      }),
    );
    document.dispositions = [
      { line: 1, kind: "requirement", requirement_id: "R-001" },
      {
        line: 2,
        kind: "requirement",
        requirement_id: "R-002",
        rationale: "Requires user authorization",
      },
    ];
    expect(validateRequirements(prompt, document)).toEqual([]);

    const unlinked = structuredClone(document);
    delete (unlinked.dispositions as Record<string, unknown>[])[1]!.requirement_id;
    expect(validateRequirements(prompt, unlinked)).toContain(
      "dispositions[1] must declare exactly one of requirement_id or requirement_ids",
    );

    const plural = structuredClone(document);
    const disposition = (plural.dispositions as Record<string, unknown>[])[1]!;
    delete disposition.requirement_id;
    disposition.requirement_ids = ["R-002"];
    expect(validateRequirements(prompt, plural)).toEqual([]);
  });

  test("represents mixed plural authority through atomic requirement dispositions", () => {
    const prompt = "Implement the local change and publish it";
    const document = requirementsDocument(prompt);
    const requirements = document.requirements as Record<string, unknown>[];
    requirements.push(
      Object.assign(requirement("R-002", 1, prompt), { disposition: "needs_authority" }),
    );
    document.dispositions = [
      {
        line: 1,
        kind: "requirement",
        requirement_ids: ["R-001", "R-002"],
        rationale: "Publishing requires user authority while the local change does not.",
      },
    ];
    expect(validateRequirements(prompt, document)).toEqual([]);

    const missingRationale = structuredClone(document);
    delete (missingRationale.dispositions as Record<string, unknown>[])[0]!.rationale;
    expect(validateRequirements(prompt, missingRationale)).toContain(
      "dispositions[0].rationale is required when a linked requirement needs authority",
    );

    const deprecatedKind = structuredClone(document);
    (deprecatedKind.dispositions as Record<string, unknown>[])[0]!.kind = "needs_authority";
    expect(validateRequirements(prompt, deprecatedKind)).toContain(
      "dispositions[0].kind must be requirement for an obligation in version 1",
    );
  });

  test("rejects planner-declared out-of-scope disposal", () => {
    const prompt = "Build it";
    const document = requirementsDocument(prompt);
    (document.requirements as Record<string, unknown>[])[0]!.disposition = "out_of_scope";
    expect(validateRequirements(prompt, document)).toContain(
      "requirements[0].disposition cannot be out_of_scope in a plan; use needs_authority",
    );

    (document.requirements as Record<string, unknown>[])[0]!.disposition = "needs_authority";
    document.dispositions = [
      {
        line: 1,
        kind: "out_of_scope",
        requirement_id: "R-001",
        rationale: "The planner attempted to discard work",
      },
    ];
    expect(validateRequirements(prompt, document)).toContain(
      "dispositions[0].kind must be requirement for an obligation in version 1",
    );
  });

  test("validates requirement dependencies", () => {
    const prompt = "Build it";
    const document = requirementsDocument(prompt);
    const planned = (document.requirements as Record<string, unknown>[])[0]!;
    planned.dependencies = ["R-404"];
    expect(validateRequirements(prompt, document)).not.toEqual([]);
    planned.dependencies = ["R-001"];
    expect(validateRequirements(prompt, document)).not.toEqual([]);
  });

  test("planning documents cannot fabricate runtime authority decisions", () => {
    const prompt = "Build it";
    for (const [field, value] of [
      ["authority_status", "granted"],
      ["authority_history", [{ decision: "grant" }]],
    ] as const) {
      const document = requirementsDocument(prompt);
      (document.requirements as Record<string, unknown>[])[0]![field] = value;
      expect(validateRequirements(prompt, document)).toContain(
        `requirements[0].${field} is runtime-only`,
      );
    }
  });

  test("hashes exact prompt bytes and preserves a UTF-8 BOM in source lines", () => {
    const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("Build it")]);
    const prompt = "\uFEFFBuild it";
    const document = requirementsDocument(prompt);
    document.prompt_sha256 = createHash("sha256").update(bytes).digest("hex");
    expect(validateRequirements(bytes, document)).toEqual([]);
    const requirement = (document.requirements as Record<string, unknown>[])[0]!;
    requirement.source_excerpt = "Build it";
    expect(validateRequirements(bytes, document)).not.toEqual([]);
  });

  test("requirement dependencies must remain acyclic", () => {
    const prompt = "First\n\nThird";
    const document = requirementsDocument(prompt);
    const requirements = document.requirements as Record<string, unknown>[];
    requirements[0]!.dependencies = ["R-002"];
    requirements[1]!.dependencies = ["R-001"];
    expect(validateRequirements(prompt, document)).not.toEqual([]);
  });
});
