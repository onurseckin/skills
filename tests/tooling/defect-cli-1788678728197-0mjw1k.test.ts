import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  evaluateCommandLookup,
  type CommandLookupContext,
  type CommandLookupResult,
} from "../../olt/scripts/src/tooling/defect-cli-1788678728197-0mjw1k.ts";

describe("Defect Remediation: defect-cli-1788678728197-0mjw1k", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788678728197-0mjw1k");
    expect(ERROR_CODE).toBe("INVALID_ARGUMENT");
    expect(DEFECT_TITLE.includes("nope")).toBe(true);
  });

  test("accepts valid registered subcommand", () => {
    const ctx: CommandLookupContext = {
      command: "doctor",
      validSubcommands: ["doctor", "help", "version"],
    };
    const result: CommandLookupResult = evaluateCommandLookup(ctx);
    expect(result.remediated).toBe(true);
    expect(result.success).toBe(true);
  });

  test("rejects unknown command 'nope' with INVALID_ARGUMENT", () => {
    const ctx: CommandLookupContext = {
      command: "nope",
      validSubcommands: ["doctor", "help"],
    };
    const result: CommandLookupResult = evaluateCommandLookup(ctx);
    expect(result.remediated).toBe(true);
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODE);
    expect(result.error).toBe("unknown command: nope");
  });
});
