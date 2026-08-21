import { describe, expect, test } from "bun:test";
import { parseRawFindings } from "../../../../orchestrating-long-tasks/scripts/src/workflow/completion/parse-raw-findings.ts";

describe("parseRawFindings", () => {
  test("returns an empty list when neither inline text nor a file is supplied", () => {
    expect(parseRawFindings(undefined, undefined)).toEqual([]);
    expect(parseRawFindings("   ", undefined)).toEqual([]);
  });

  test("throws INVALID_ARGUMENT when the findings file cannot be read", () => {
    expect(() => parseRawFindings(undefined, "/nonexistent/findings.json")).toThrow(
      /cannot read findings file: \/nonexistent\/findings\.json/,
    );
  });

  test("throws INVALID_ARGUMENT when the inline payload is not valid JSON", () => {
    expect(() => parseRawFindings("{not json", undefined)).toThrow(
      /findings payload is not valid JSON/,
    );
  });

  test("throws INVALID_ARGUMENT for a payload that is neither an object nor an array", () => {
    expect(() => parseRawFindings("42", undefined)).toThrow(
      /findings payload must be a JSON object or array/,
    );
  });

  test("reads a bare JSON array of findings", () => {
    const findings = parseRawFindings(
      JSON.stringify([
        {
          id: "F-1",
          severity: "critical",
          requirement_id: "R-1",
          observation: "obs",
          remediation: "fix it",
          revalidation: "re-run the gate",
        },
      ]),
      undefined,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.id).toBe("F-1");
  });

  test("reads findings nested under a { findings: [...] } wrapper object", () => {
    const findings = parseRawFindings(
      JSON.stringify({
        findings: [
          {
            id: "F-1",
            severity: "minor",
            requirement_id: "R-1",
            observation: "obs",
            remediation: "fix it",
            revalidation: "re-run",
          },
        ],
      }),
      undefined,
    );
    expect(findings).toHaveLength(1);
  });

  test("treats a single bare finding object (no findings wrapper, no array) as a one-item list", () => {
    const findings = parseRawFindings(
      JSON.stringify({
        id: "F-1",
        severity: "important",
        requirement_id: "R-1",
        observation: "obs",
        remediation: "fix it",
        revalidation: "re-run",
      }),
      undefined,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.id).toBe("F-1");
  });

  test("throws when an entry in the findings array is not itself an object", () => {
    expect(() => parseRawFindings(JSON.stringify(["not-an-object"]), undefined)).toThrow(
      /completion finding #1 must be an object/,
    );
  });

  test("throws when an entry in the findings array is an array rather than an object", () => {
    expect(() => parseRawFindings(JSON.stringify([[1, 2, 3]]), undefined)).toThrow(
      /completion finding #1 must be an object/,
    );
  });

  test("rejects a finding with a missing or blank required field", () => {
    expect(() => parseRawFindings(JSON.stringify([{ severity: "minor" }]), undefined)).toThrow(
      /completion finding #1 must carry a nonempty id/,
    );
  });

  test("rejects a finding with an unrecognised severity", () => {
    expect(() =>
      parseRawFindings(JSON.stringify([{ id: "F-1", severity: "urgent" }]), undefined),
    ).toThrow(/must declare severity critical, important or minor/);
  });

  test("defaults evidence to a critic_assertion entry when none is supplied", () => {
    const [finding] = parseRawFindings(
      JSON.stringify([
        {
          id: "F-1",
          severity: "minor",
          requirement_id: "R-1",
          observation: "obs",
          remediation: "fix it",
          revalidation: "re-run",
        },
      ]),
      undefined,
    );
    expect(finding!.evidence).toEqual([
      { kind: "critic_assertion", evidence_class: "agent_reported", observation: "obs" },
    ]);
  });

  test("keeps supplied evidence objects, dropping non-object entries", () => {
    const [finding] = parseRawFindings(
      JSON.stringify([
        {
          id: "F-1",
          severity: "minor",
          requirement_id: "R-1",
          observation: "obs",
          remediation: "fix it",
          revalidation: "re-run",
          evidence: [{ kind: "command", reference: "C-1" }, "not-an-object", 42],
        },
      ]),
      undefined,
    );
    expect(finding!.evidence).toEqual([{ kind: "command", reference: "C-1" }]);
  });

  test("falls back to the default evidence when the supplied evidence array is empty after filtering", () => {
    const [finding] = parseRawFindings(
      JSON.stringify([
        {
          id: "F-1",
          severity: "minor",
          requirement_id: "R-1",
          observation: "obs",
          remediation: "fix it",
          revalidation: "re-run",
          evidence: ["not-an-object"],
        },
      ]),
      undefined,
    );
    expect(finding!.evidence).toEqual([
      { kind: "critic_assertion", evidence_class: "agent_reported", observation: "obs" },
    ]);
  });

  test("keeps non-empty, trimmed file_paths and omits the field when absent", () => {
    const [withPaths, withoutPaths] = parseRawFindings(
      JSON.stringify([
        {
          id: "F-1",
          severity: "minor",
          requirement_id: "R-1",
          observation: "obs",
          remediation: "fix it",
          revalidation: "re-run",
          file_paths: [" src/a.ts ", "", "src/b.ts"],
        },
        {
          id: "F-2",
          severity: "minor",
          requirement_id: "R-1",
          observation: "obs",
          remediation: "fix it",
          revalidation: "re-run",
        },
      ]),
      undefined,
    );
    expect(withPaths!.file_paths).toEqual(["src/a.ts", "src/b.ts"]);
    expect(withoutPaths!.file_paths).toBeUndefined();
  });

  test("omits file_paths when the field is present but every entry is blank", () => {
    const [finding] = parseRawFindings(
      JSON.stringify([
        {
          id: "F-1",
          severity: "minor",
          requirement_id: "R-1",
          observation: "obs",
          remediation: "fix it",
          revalidation: "re-run",
          file_paths: ["   ", 42],
        },
      ]),
      undefined,
    );
    expect(finding!.file_paths).toBeUndefined();
  });
});
