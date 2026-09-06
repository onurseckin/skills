import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  validateCommandDispatch,
  type CommandValidationContext,
  type CommandValidationResult,
} from "../../olt/scripts/src/tooling/defect-cli-1788678214570-ttcwcy.ts";

describe("Defect Remediation: defect-cli-1788678214570-ttcwcy", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788678214570-ttcwcy");
    expect(ERROR_CODE).toBe("INVALID_ARGUMENT");
    expect(DEFECT_TITLE.includes("nope")).toBe(true);
  });

  test("accepts valid known commands", () => {
    const ctx: CommandValidationContext = {
      requestedCommand: "run:status",
      availableCommands: ["run:status", "run:exec", "task:brief"],
    };
    const result: CommandValidationResult = validateCommandDispatch(ctx);
    expect(result.remediated).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test("rejects invalid 'nope' command with INVALID_ARGUMENT error", () => {
    const ctx: CommandValidationContext = {
      requestedCommand: "nope",
      availableCommands: ["run:status", "run:exec"],
    };
    const result: CommandValidationResult = validateCommandDispatch(ctx);
    expect(result.remediated).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODE);
    expect(result.error).toBe("unknown command: nope");
  });
});
