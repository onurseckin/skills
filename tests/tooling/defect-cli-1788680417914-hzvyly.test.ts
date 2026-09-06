import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  validateRequirementProofCommand,
  type RequirementProofValidationContext,
  type RequirementProofValidationResult,
} from "../../olt/scripts/src/tooling/defect-cli-1788680417914-hzvyly.ts";

describe("Defect Remediation: defect-cli-1788680417914-hzvyly", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788680417914-hzvyly");
    expect(ERROR_CODE).toBe("INVALID_STATE");
    expect(DEFECT_TITLE.includes("C-4d96270c-8122-4e98-a4cf-94434c945f85")).toBe(true);
  });

  test("rejects invalid requirement proof command without successful execution", () => {
    const ctx: RequirementProofValidationContext = {
      requirementId: "REQ-01",
      proofCommandId: "C-4d96270c-8122-4e98-a4cf-94434c945f85",
      recordedCommands: [],
    };
    const result: RequirementProofValidationResult = validateRequirementProofCommand(ctx);
    expect(result.remediated).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODE);
    expect(result.error).toBe(
      "requirement proof command is invalid: C-4d96270c-8122-4e98-a4cf-94434c945f85",
    );
  });

  test("accepts valid requirement proof command with zero exitCode and terminal output", () => {
    const ctx: RequirementProofValidationContext = {
      requirementId: "REQ-01",
      proofCommandId: "C-4d96270c-8122-4e98-a4cf-94434c945f85",
      recordedCommands: [
        {
          commandId: "C-4d96270c-8122-4e98-a4cf-94434c945f85",
          exitCode: 0,
          passed: true,
          hasTerminalOutput: true,
        },
      ],
    };
    const result: RequirementProofValidationResult = validateRequirementProofCommand(ctx);
    expect(result.remediated).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });
});
