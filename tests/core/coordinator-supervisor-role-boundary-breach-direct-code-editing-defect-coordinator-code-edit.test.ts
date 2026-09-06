import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  validateDefectPreconditions,
  verifyDefectRemediation,
  type DefectRemediationContext,
  type DefectRemediationResult,
} from "../../olt/scripts/src/core/coordinator-supervisor-role-boundary-breach-direct-code-editing-defect-coordinator-code-edit.ts";

describe("Defect Remediation: DEFECT-COORDINATOR-CODE-EDIT", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("DEFECT-COORDINATOR-CODE-EDIT");
    expect(ERROR_CODE).toBe("COORDINATOR_DIRECT_CODE_EDIT");
    expect(DEFECT_TITLE.length).toBeGreaterThan(0);
  });

  test("validates compliant execution context cleanly", () => {
    const validCtx: DefectRemediationContext = {
      actor: "implementer_lane_4",
      role: "implementer",
      taskId: "task-20",
      state: "validating",
      sessionToken: "tok_live_core_DEFECT-COORDINATOR-CODE-EDIT",
      scope: ["olt/scripts/src/core/coordinator-supervisor-role-boundary-breach-direct-code-editing-defect-coordinator-code-edit.ts"],
      gateCommand: "bun test tests/core/coordinator-supervisor-role-boundary-breach-direct-code-editing-defect-coordinator-code-edit.test.ts",
      options: ["--compliant"],
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
      options: ["--disallowed-option"],
    };
    expect(validateDefectPreconditions(invalidCtx)).toBe(false);
    const result = verifyDefectRemediation(invalidCtx);
    expect(result.remediated).toBe(true);
    expect(result.allowed).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errorCode).toBe(ERROR_CODE);
  });
});
