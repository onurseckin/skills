import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  dispatchCommand37,
  type CommandDispatcherContext37,
  type CommandDispatcherResult37,
} from "../../olt/scripts/src/tooling/defect-cli-1788682423077-p30xex.ts";

describe("Defect Remediation: defect-cli-1788682423077-p30xex", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788682423077-p30xex");
    expect(ERROR_CODE).toBe("INVALID_ARGUMENT");
    expect(DEFECT_TITLE.includes("nope")).toBe(true);
  });

  test("accepts recognized command", () => {
    const ctx: CommandDispatcherContext37 = {
      rawCommand: "version",
      supportedCommands: ["version", "status"],
    };
    const result: CommandDispatcherResult37 = dispatchCommand37(ctx);
    expect(result.remediated).toBe(true);
    expect(result.recognized).toBe(true);
  });

  test("rejects nope with INVALID_ARGUMENT", () => {
    const ctx: CommandDispatcherContext37 = {
      rawCommand: "nope",
      supportedCommands: ["version", "status"],
    };
    const result: CommandDispatcherResult37 = dispatchCommand37(ctx);
    expect(result.remediated).toBe(true);
    expect(result.recognized).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODE);
    expect(result.error).toBe("unknown command: nope");
  });
});
