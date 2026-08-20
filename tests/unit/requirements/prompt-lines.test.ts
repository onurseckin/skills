import { describe, expect, test } from "bun:test";
import { compileRequirementsFromPrompt } from "../../../orchestrating-long-tasks/scripts/src/requirements/compiler.ts";
import { promptLines } from "../../../orchestrating-long-tasks/scripts/src/requirements/prompt-lines.ts";
import { promptSource } from "../../../orchestrating-long-tasks/scripts/src/requirements/prompt-source.ts";
import { validateRequirements } from "../../../orchestrating-long-tasks/scripts/src/requirements/validate-requirements.ts";

const EXOTIC_PROMPT =
  "Ship the parser\vHandle vertical tabs\fHandle form feeds\u0085Handle next line\u2028Handle line separators\u2029Handle paragraph separators\r\nHandle CRLF\nHandle LF";

const EXOTIC_LINES = [
  "Ship the parser",
  "Handle vertical tabs",
  "Handle form feeds",
  "Handle next line",
  "Handle line separators",
  "Handle paragraph separators",
  "Handle CRLF",
  "Handle LF",
];

interface TaskDeclarationFixture {
  id: string;
  label: string;
  writeScope: string[];
  gate: string;
}

function task(index: number): TaskDeclarationFixture {
  return {
    id: `task-${index}`,
    label: `Task ${index}`,
    writeScope: [`src/feature${index}`],
    gate: `bun test tests/unit/feature${index}`,
  };
}

describe("prompt line splitting", () => {
  test("splits on every Unicode line terminator the validator recognizes", () => {
    expect(promptLines(EXOTIC_PROMPT)).toEqual(EXOTIC_LINES);
    expect(promptSource(EXOTIC_PROMPT)?.lines).toEqual(EXOTIC_LINES);
  });

  test("drops only the empty line a trailing terminator produces", () => {
    expect(promptLines("")).toEqual([]);
    expect(promptLines("only line")).toEqual(["only line"]);
    for (const terminator of ["\n", "\r\n", "\v", "\f", "\u0085", "\u2028", "\u2029", "\u001c"]) {
      expect(promptLines(`only line${terminator}`)).toEqual(["only line"]);
    }
    expect(promptLines("first\v\vthird")).toEqual(["first", "", "third"]);
  });

  test("compiler numbers exotic prompt lines exactly as the validator does", () => {
    const result = compileRequirementsFromPrompt(EXOTIC_PROMPT, [task(1), task(2), task(3)]);
    const requirements = result.atomicRequirements;

    expect(requirements.map((requirement) => requirement.source_lines)).toEqual([[1], [2], [3]]);
    expect(requirements.map((requirement) => requirement.source_excerpt)).toEqual(
      EXOTIC_LINES.slice(0, 3),
    );
    expect(result.requirementsDocument.dispositions).toHaveLength(EXOTIC_LINES.length);
    expect(validateRequirements(EXOTIC_PROMPT, result.requirementsDocument)).toEqual([]);
  });

  test("compiler binds one requirement per line across a paragraph separator", () => {
    const prompt = "alpha\u2029omega";
    const result = compileRequirementsFromPrompt(prompt, [task(1), task(2)]);

    expect(result.atomicRequirements.map((requirement) => requirement.source_excerpt)).toEqual([
      "alpha",
      "omega",
    ]);
    expect(validateRequirements(prompt, result.requirementsDocument)).toEqual([]);
  });
});
