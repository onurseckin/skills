import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  validatePositionalArguments,
  type PositionalArgValidationContext,
  type PositionalArgValidationResult,
} from "../../olt/scripts/src/tooling/defect-cli-1788679598191-zi2hmq.ts";

describe("Defect Remediation: defect-cli-1788679598191-zi2hmq", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788679598191-zi2hmq");
    expect(ERROR_CODE).toBe("INVALID_ARGUMENT");
    expect(DEFECT_TITLE.includes("coordinator-tool-guard.ts")).toBe(true);
  });

  test("rejects unexpected positional argument when not allowed", () => {
    const ctx: PositionalArgValidationContext = {
      command: "guard:check",
      positionalArgs: [
        "/Users/onurseckinsenoglu/repos/skills/olt/scripts/src/authority/guards/coordinator-tool-guard.ts",
      ],
      allowsPositional: false,
    };
    const result: PositionalArgValidationResult = validatePositionalArguments(ctx);
    expect(result.remediated).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODE);
    expect(result.error).toContain(
      "unexpected positional argument: /Users/onurseckinsenoglu/repos/skills/olt/scripts/src/authority/guards/coordinator-tool-guard.ts",
    );
  });

  test("normalizes positional argument to flag when allowed", () => {
    const ctx: PositionalArgValidationContext = {
      command: "guard:check",
      positionalArgs: [
        "/Users/onurseckinsenoglu/repos/skills/olt/scripts/src/authority/guards/coordinator-tool-guard.ts",
      ],
      allowsPositional: true,
      expectedFlagForPositional: "--file",
    };
    const result: PositionalArgValidationResult = validatePositionalArguments(ctx);
    expect(result.remediated).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.normalizedFlags["--file"]).toBe(
      "/Users/onurseckinsenoglu/repos/skills/olt/scripts/src/authority/guards/coordinator-tool-guard.ts",
    );
  });

  test("passes when no positional arguments are provided", () => {
    const ctx: PositionalArgValidationContext = {
      command: "guard:check",
      positionalArgs: [],
    };
    const result: PositionalArgValidationResult = validatePositionalArguments(ctx);
    expect(result.valid).toBe(true);
  });
});
