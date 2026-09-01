import { describe, expect, test } from "bun:test";
import {
  collectReplanFindings,
  UNREPORTED_REMEDIATION,
} from "../../../../../olt/scripts/src/cli/commands/plan-replan-findings.ts";
import { firstAvailableRunId } from "../../../../../olt/scripts/src/cli/commands/orchestrate-slug.ts";

describe("collectReplanFindings", () => {
  const noRead = (): string => {
    throw new Error("readFile should not be called");
  };

  test("parses an inline JSON array payload", () => {
    const findings = collectReplanFindings({
      inline: JSON.stringify([
        { observation: "it crashed", severity: "critical", remediation: "fix it" },
      ]),
      file: undefined,
      readFile: noRead,
      recorded: undefined,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      id: "finding-critic-1",
      observation: "it crashed",
      severity: "critical",
      remediation: "fix it",
    });
  });

  test("accepts a wrapped { findings: [...] } object and a bare single-object payload", () => {
    const wrapped = collectReplanFindings({
      inline: JSON.stringify({ findings: [{ observation: "wrapped", severity: "minor" }] }),
      file: undefined,
      readFile: noRead,
      recorded: undefined,
    });
    expect(wrapped[0]!.observation).toBe("wrapped");

    const bare = collectReplanFindings({
      inline: JSON.stringify({ observation: "bare object", severity: "minor" }),
      file: undefined,
      readFile: noRead,
      recorded: undefined,
    });
    expect(bare[0]!.observation).toBe("bare object");
  });

  test("falls back to the injected readFile when inline is absent but a file is named", () => {
    const findings = collectReplanFindings({
      inline: undefined,
      file: "findings.json",
      readFile: (path) => {
        expect(path).toBe("findings.json");
        return JSON.stringify([{ finding: "from file", severity: "important" }]);
      },
      recorded: undefined,
    });
    expect(findings[0]!.observation).toBe("from file");
  });

  test("throws INVALID_ARGUMENT when the injected readFile itself throws", () => {
    expect(() =>
      collectReplanFindings({
        inline: undefined,
        file: "missing.json",
        readFile: () => {
          throw new Error("ENOENT");
        },
        recorded: undefined,
      }),
    ).toThrow(/cannot read findings file: missing.json/);
  });

  test("throws INVALID_ARGUMENT on malformed JSON", () => {
    expect(() =>
      collectReplanFindings({
        inline: "not json",
        file: undefined,
        readFile: noRead,
        recorded: undefined,
      }),
    ).toThrow(/not valid JSON/);
  });

  test("falls back to state.completion_review.findings when no inline/file content is supplied", () => {
    const findings = collectReplanFindings({
      inline: undefined,
      file: undefined,
      readFile: noRead,
      recorded: { findings: [{ message: "from review", severity: "suggestion" }] },
    });
    expect(findings[0]!.observation).toBe("from review");
  });

  test("falls back to recorded findings when supplied content parses to an empty array", () => {
    const findings = collectReplanFindings({
      inline: "[]",
      file: undefined,
      readFile: noRead,
      recorded: { findings: [{ observation: "recorded wins", severity: "minor" }] },
    });
    expect(findings[0]!.observation).toBe("recorded wins");
  });

  test("returns an empty list when nothing at all is available", () => {
    expect(
      collectReplanFindings({
        inline: undefined,
        file: undefined,
        readFile: noRead,
        recorded: undefined,
      }),
    ).toEqual([]);
    expect(
      collectReplanFindings({
        inline: undefined,
        file: undefined,
        readFile: noRead,
        recorded: { findings: "not-an-array" },
      }),
    ).toEqual([]);
  });

  test("throws when a finding declares no observation", () => {
    expect(() =>
      collectReplanFindings({
        inline: JSON.stringify([{ severity: "minor" }]),
        file: undefined,
        readFile: noRead,
        recorded: undefined,
      }),
    ).toThrow(/carries no observation/);
  });

  test("throws when a finding declares an unrecognised severity", () => {
    expect(() =>
      collectReplanFindings({
        inline: JSON.stringify([{ observation: "x", severity: "urgent" }]),
        file: undefined,
        readFile: noRead,
        recorded: undefined,
      }),
    ).toThrow(/must declare severity/);
  });

  test("defaults remediation to unreported-remediation constant and honours explicit file_paths/file_path/path", () => {
    const [noRemediation, plural, singleFilePath, pathField] = collectReplanFindings({
      inline: JSON.stringify([
        { observation: "a", severity: "minor" },
        { observation: "b", severity: "minor", file_paths: ["x.ts", "y.ts"] },
        { observation: "c", severity: "minor", file_path: "z.ts" },
        { observation: "d", severity: "minor", path: "w.ts" },
      ]),
      file: undefined,
      readFile: noRead,
      recorded: undefined,
    });
    expect(noRemediation!.remediation).toBe(UNREPORTED_REMEDIATION);
    expect(plural!.file_paths).toEqual(["x.ts", "y.ts"]);
    expect(singleFilePath!.file_paths).toEqual(["z.ts"]);
    expect(pathField!.file_paths).toEqual(["w.ts"]);
  });

  test("preserves explicit id and honours revalidation_gate and requirement_id when present", () => {
    const [finding] = collectReplanFindings({
      inline: JSON.stringify([
        {
          id: "finding-explicit",
          observation: "x",
          severity: "minor",
          requirement_id: "R-9",
          revalidation_gate: "bun gate.ts",
        },
      ]),
      file: undefined,
      readFile: noRead,
      recorded: undefined,
    });
    expect(finding!.id).toBe("finding-explicit");
    expect(finding!.requirement_id).toBe("R-9");
    expect(finding!.revalidation_gate).toBe("bun gate.ts");
  });
});

describe("firstAvailableRunId exhaustion", () => {
  test("throws once every numbered suffix up to 999 is reported taken", () => {
    expect(() => firstAvailableRunId("busy", () => true)).toThrow(
      "could not find an available run id derived from busy",
    );
  });

  test("collectReplanFindings falls back to open task findings from tasks", () => {
    const findings = collectReplanFindings({
      inline: undefined,
      file: undefined,
      readFile: () => "",
      recorded: undefined,
      tasks: {
        "task-1": {
          findings: [
            { status: "open", observation: "Open finding 1", severity: "minor" },
            { status: "resolved", observation: "Resolved finding", severity: "minor" },
          ],
        },
      },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.observation).toBe("Open finding 1");
  });
});

describe("Static Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
  test("verifies plan-replan-helpers test file contains zero any and zero suppressions", async () => {
    const testContent = await Bun.file(import.meta.path).text();
    const forbiddenAnyRegex = new RegExp(":[ \\t]*" + "any\\b");
    const forbiddenCastRegex = new RegExp("\\bas[ \\t]+" + "any\\b");
    const forbiddenSuppressionsRegex = new RegExp("@ts-" + "(ignore|expect-error|nocheck)");
    const forbiddenLintRegex = new RegExp("(eslint|oxlint)" + "-disable");

    expect(testContent).not.toMatch(forbiddenAnyRegex);
    expect(testContent).not.toMatch(forbiddenCastRegex);
    expect(testContent).not.toMatch(forbiddenSuppressionsRegex);
    expect(testContent).not.toMatch(forbiddenLintRegex);
  });
});
