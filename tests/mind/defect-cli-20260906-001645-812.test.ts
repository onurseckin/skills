import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  validateDefectPreconditions,
  verifyDefectRemediation,
  type DefectRemediationContext,
  type DefectRemediationResult,
} from "../../olt/scripts/src/mind/defect-cli-20260906-001645-812.ts";

describe("Defect Remediation: defect-cli-20260906-001645-812", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-cli-20260906-001645-812");
    expect(ERROR_CODE).toBe("INVALID_ARGUMENT");
    expect(DEFECT_TITLE.length).toBeGreaterThan(0);
  });

  test("validates compliant execution context cleanly", () => {
    const validCtx: DefectRemediationContext = {
      actor: "implementer_task-18",
      role: "implementer",
      taskId: "task-18",
      state: "validating",
      sessionToken: "tok_live_defect_cli_20260906_001645_812",
      scope: ["olt/scripts/src/mind/defect-cli-20260906-001645-812.ts"],
      gateCommand: "bun test tests/mind/defect-cli-20260906-001645-812.test.ts",
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
