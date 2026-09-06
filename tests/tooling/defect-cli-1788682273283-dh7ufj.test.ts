import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  validateCommand35,
  type CommandValidatorContext35,
  type CommandValidatorResult35,
} from "../../olt/scripts/src/tooling/defect-cli-1788682273283-dh7ufj.ts";

describe("Defect Remediation: defect-cli-1788682273283-dh7ufj", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788682273283-dh7ufj");
    expect(ERROR_CODE).toBe("INVALID_ARGUMENT");
    expect(DEFECT_TITLE.includes("nope")).toBe(true);
  });

  test("accepts valid allowed command", () => {
    const ctx: CommandValidatorContext35 = {
      command: "run:status",
      allowedCommands: ["run:status", "queue:wave"],
    };
    const result: CommandValidatorResult35 = validateCommand35(ctx);
    expect(result.remediated).toBe(true);
    expect(result.allowed).toBe(true);
  });

  test("rejects invalid 'nope' command", () => {
    const ctx: CommandValidatorContext35 = {
      command: "nope",
      allowedCommands: ["run:status", "queue:wave"],
    };
    const result: CommandValidatorResult35 = validateCommand35(ctx);
    expect(result.remediated).toBe(true);
    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODE);
    expect(result.error).toBe("unknown command: nope");
  });
});
