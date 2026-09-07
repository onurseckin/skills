import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  validateDefectPreconditions,
  verifyDefectRemediation,
  type DefectRemediationContext,
  type DefectRemediationResult,
} from "../../olt/scripts/src/validation/tasks-changing-rendered-surfaces-can-be-reviewed-and-closed-without-any-ui-prefixed-validator-defect-ui-scope-accepts-generic-validator.ts";

describe("Defect Remediation: defect-ui-scope-accepts-generic-validator", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-ui-scope-accepts-generic-validator");
    expect(ERROR_CODE).toBe("UI_WRITE_SCOPE_ACCEPTS_NON_UI_VALIDATOR");
    expect(DEFECT_TITLE.length).toBeGreaterThan(0);
  });

  test("validates compliant execution context cleanly", () => {
    const validCtx: DefectRemediationContext = {
      actor: "implementer_b2",
      role: "implementer",
      taskId: "task-23",
      state: "validating",
      sessionToken: "tok_live_19c1a588f592d5702128ab98d1e9cbc52bdaf68cbe18c9d0",
      scope: [
        "olt/scripts/src/validation/tasks-changing-rendered-surfaces-can-be-reviewed-and-closed-without-any-ui-prefixed-validator-defect-ui-scope-accepts-generic-validator.ts",
      ],
      gateCommand:
        "bun test tests/validation/tasks-changing-rendered-surfaces-can-be-reviewed-and-closed-without-any-ui-prefixed-validator-defect-ui-scope-accepts-generic-validator.test.ts",
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
