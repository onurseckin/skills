import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  validateCommandEventActor,
  type CommandActorValidationContext,
  type CommandActorValidationResult,
} from "../../olt/scripts/src/tooling/defect-cli-1788680122040-z358j6.ts";

describe("Defect Remediation: defect-cli-1788680122040-z358j6", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788680122040-z358j6");
    expect(ERROR_CODE).toBe("INVALID_STATE");
    expect(DEFECT_TITLE.includes("command event actor")).toBe(true);
  });

  test("passes when command actor matches event actor", () => {
    const ctx: CommandActorValidationContext = {
      commandId: "C-1234",
      commandActor: "implementer-01",
      eventActor: "implementer-01",
    };
    const result: CommandActorValidationResult = validateCommandEventActor(ctx);
    expect(result.remediated).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test("rejects when command event actor does not match command actor", () => {
    const ctx: CommandActorValidationContext = {
      commandId: "C-1234",
      commandActor: "implementer-01",
      eventActor: "coordinator-01",
    };
    const result: CommandActorValidationResult = validateCommandEventActor(ctx);
    expect(result.remediated).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODE);
    expect(result.error).toBe(
      "command event actor does not match command actor",
    );
  });
});
