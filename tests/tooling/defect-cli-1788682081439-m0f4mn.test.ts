import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  validateProofCommand33,
  type ProofCommandValidationContext,
  type ProofCommandValidationResult,
} from "../../olt/scripts/src/tooling/defect-cli-1788682081439-m0f4mn.ts";

describe("Defect Remediation: defect-cli-1788682081439-m0f4mn", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788682081439-m0f4mn");
    expect(ERROR_CODE).toBe("INVALID_STATE");
    expect(
      DEFECT_TITLE.includes("C-4ac7f9ea-b9a8-42e9-8bf0-7f4dc83f06de"),
    ).toBe(true);
  });

  test("rejects invalid requirement proof command", () => {
    const ctx: ProofCommandValidationContext = {
      proofCommandId: "C-4ac7f9ea-b9a8-42e9-8bf0-7f4dc83f06de",
      executedCommands: [],
    };
    const result: ProofCommandValidationResult = validateProofCommand33(ctx);
    expect(result.remediated).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODE);
    expect(result.error).toBe(
      "requirement proof command is invalid: C-4ac7f9ea-b9a8-42e9-8bf0-7f4dc83f06de",
    );
  });

  test("passes valid requirement proof command", () => {
    const ctx: ProofCommandValidationContext = {
      proofCommandId: "C-4ac7f9ea-b9a8-42e9-8bf0-7f4dc83f06de",
      executedCommands: [
        {
          commandId: "C-4ac7f9ea-b9a8-42e9-8bf0-7f4dc83f06de",
          exitCode: 0,
          verified: true,
        },
      ],
    };
    const result: ProofCommandValidationResult = validateProofCommand33(ctx);
    expect(result.remediated).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });
});
