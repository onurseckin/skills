import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  evaluateCommandDispatch29,
  type CommandDispatchContext29,
  type CommandDispatchResult29,
} from "../../olt/scripts/src/tooling/defect-cli-1788680928744-29nlml.ts";

describe("Defect Remediation: defect-cli-1788680928744-29nlml", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788680928744-29nlml");
    expect(ERROR_CODE).toBe("INVALID_ARGUMENT");
    expect(DEFECT_TITLE.includes("nope")).toBe(true);
  });

  test("accepts registered commands", () => {
    const ctx: CommandDispatchContext29 = {
      requestedCommand: "status",
      commandRegistry: ["status", "help"],
    };
    const result: CommandDispatchResult29 = evaluateCommandDispatch29(ctx);
    expect(result.remediated).toBe(true);
    expect(result.recognized).toBe(true);
  });

  test("rejects nope with INVALID_ARGUMENT", () => {
    const ctx: CommandDispatchContext29 = {
      requestedCommand: "nope",
      commandRegistry: ["status", "help"],
    };
    const result: CommandDispatchResult29 = evaluateCommandDispatch29(ctx);
    expect(result.remediated).toBe(true);
    expect(result.recognized).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODE);
    expect(result.error).toBe("unknown command: nope");
  });
});
