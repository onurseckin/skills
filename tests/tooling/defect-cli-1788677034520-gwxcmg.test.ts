import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  computeLevenshteinDistance,
  findBestCommandSuggestion,
  resolveRunCheckDefect,
  type CommandSuggestionContext,
  type CommandSuggestionResult,
} from "../../olt/scripts/src/tooling/defect-cli-1788677034520-gwxcmg.ts";

describe("Defect Remediation: defect-cli-1788677034520-gwxcmg", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788677034520-gwxcmg");
    expect(ERROR_CODE).toBe("INVALID_ARGUMENT");
    expect(DEFECT_TITLE.includes("run:check")).toBe(true);
  });

  test("computes Levenshtein distance correctly", () => {
    expect(computeLevenshteinDistance("run:check", "run:exec")).toBe(3);
    expect(computeLevenshteinDistance("kitten", "sitting")).toBe(3);
    expect(computeLevenshteinDistance("same", "same")).toBe(0);
    expect(computeLevenshteinDistance("", "abc")).toBe(3);
  });

  test("finds best command suggestion for typographical errors", () => {
    const commands = ["run:exec", "run:status", "task:claim", "task:submit"];
    const suggestion = findBestCommandSuggestion("run:execs", commands);
    expect(suggestion).toBe("run:exec");
  });

  test("resolves run:check explicitly to run:exec", () => {
    const ctx: CommandSuggestionContext = {
      requestedCommand: "run:check",
      availableCommands: ["run:exec", "run:status", "task:check"],
    };
    const result: CommandSuggestionResult = resolveRunCheckDefect(ctx);
    expect(result.remediated).toBe(true);
    expect(result.defectId).toBe(DEFECT_ID);
    expect(result.errorCode).toBe(ERROR_CODE);
    expect(result.matched).toBe(true);
    expect(result.suggestion).toBe("run:exec");
  });

  test("reports unknown command error when no suggestion meets threshold", () => {
    const ctx: CommandSuggestionContext = {
      requestedCommand: "completely_unrelated_cmd",
      availableCommands: ["run:exec", "run:status"],
    };
    const result: CommandSuggestionResult = resolveRunCheckDefect(ctx);
    expect(result.remediated).toBe(true);
    expect(result.matched).toBe(false);
    expect(result.error).toBe("unknown command: completely_unrelated_cmd");
  });
});
