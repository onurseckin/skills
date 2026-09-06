import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  validateDefectPreconditions,
  verifyDefectRemediation,
  type DefectRemediationContext,
  type DefectRemediationResult,
} from "../../olt/scripts/src/validation/defect-cli-1788678888442-bhqfka.ts";

describe("Defect Remediation: defect-cli-1788678888442-bhqfka", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788678888442-bhqfka");
    expect(ERROR_CODE).toBe("INTEGRITY");
    expect(DEFECT_TITLE.length).toBeGreaterThan(0);
  });

  test("validates compliant execution context cleanly", () => {
    const validCtx: DefectRemediationContext = {
      actor: "implementer_b3",
      role: "implementer",
      taskId: "task-40",
      state: "validating",
      sessionToken: "tok_live_b94d2d379be3468c60252ab3ccb622b0625321d7c425e8b0",
      scope: ["olt/scripts/src/validation/defect-cli-1788678888442-bhqfka.ts"],
      gateCommand: "bun test tests/validation/defect-cli-1788678888442-bhqfka.test.ts",
    };
    expect(validateDefectPreconditions(validCtx)).toBe(true);
    const result = verifyDefectRemediation(validCtx);
    expect(result.remediated).toBe(true);
    expect(result.allowed).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  test("rejects invalid execution context with defect error code", () => {
    const invalidCtx: DefectRemediationContext = {
      actor: "spoofed_actor",
      role: "coordinator",
      state: "unvalidated_illegal_state",
      isUiTask: true,
      validatorType: "generic-backend-validator",
    };
    expect(validateDefectPreconditions(invalidCtx)).toBe(false);
    const result = verifyDefectRemediation(invalidCtx);
    expect(result.remediated).toBe(true);
    expect(result.allowed).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errorCode).toBe(ERROR_CODE);
  });
});
