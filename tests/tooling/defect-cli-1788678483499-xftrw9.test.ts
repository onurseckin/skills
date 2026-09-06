import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  lookupCommandDispatch,
  type CommandDispatchLookupContext,
  type CommandDispatchLookupResult,
} from "../../olt/scripts/src/tooling/defect-cli-1788678483499-xftrw9.ts";

describe("Defect Remediation: defect-cli-1788678483499-xftrw9", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788678483499-xftrw9");
    expect(ERROR_CODE).toBe("INVALID_ARGUMENT");
    expect(DEFECT_TITLE.includes("nope")).toBe(true);
  });

  test("handles known supported command successfully", () => {
    const ctx: CommandDispatchLookupContext = {
      rawInput: "queue:wave",
      supportedCommands: ["queue:wave", "run:status"],
    };
    const result: CommandDispatchLookupResult = lookupCommandDispatch(ctx);
    expect(result.remediated).toBe(true);
    expect(result.recognized).toBe(true);
    expect(result.resolvedCommand).toBe("queue:wave");
  });

  test("rejects unrecognized 'nope' command without fallback", () => {
    const ctx: CommandDispatchLookupContext = {
      rawInput: "nope",
      supportedCommands: ["queue:wave", "run:status"],
    };
    const result: CommandDispatchLookupResult = lookupCommandDispatch(ctx);
    expect(result.remediated).toBe(true);
    expect(result.recognized).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODE);
    expect(result.error).toBe("unknown command: nope");
  });

  test("resolves fallback when configured for nope", () => {
    const ctx: CommandDispatchLookupContext = {
      rawInput: "nope",
      fallbackCommand: "help",
    };
    const result: CommandDispatchLookupResult = lookupCommandDispatch(ctx);
    expect(result.remediated).toBe(true);
    expect(result.recognized).toBe(true);
    expect(result.resolvedCommand).toBe("help");
  });
});
