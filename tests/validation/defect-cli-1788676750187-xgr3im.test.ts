import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  validateDefectPreconditions,
  verifyDefectRemediation,
  type DefectRemediationContext,
  type DefectRemediationResult,
} from "../../olt/scripts/src/validation/defect-cli-1788676750187-xgr3im.ts";

describe("Defect Remediation: defect-cli-1788676750187-xgr3im", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788676750187-xgr3im");
    expect(ERROR_CODE).toBe("AUTHENTICATION_FAILURE");
    expect(DEFECT_TITLE.length).toBeGreaterThan(0);
  });

  test("validates compliant execution context cleanly", () => {
    const validCtx: DefectRemediationContext = {
      actor: "implementer_b1",
      role: "implementer",
      taskId: "task-8",
      state: "validating",
      sessionToken: "tok_live_acdda43f6205ba442831e72ebe5543fdff7665204fa1d16c",
      scope: ["olt/scripts/src/validation/defect-cli-1788676750187-xgr3im.ts"],
      gateCommand: "bun test tests/validation/defect-cli-1788676750187-xgr3im.test.ts",
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
