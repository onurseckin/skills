import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  validateDefectPreconditions,
  verifyDefectRemediation,
  type DefectRemediationContext,
  type DefectRemediationResult,
} from "../../olt/scripts/src/core/defect-cli-1788679550590-b47ab2.ts";

describe("Defect Remediation: defect-cli-1788679550590-b47ab2", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788679550590-b47ab2");
    expect(ERROR_CODE).toBe("INVALID_ARGUMENT");
    expect(DEFECT_TITLE.length).toBeGreaterThan(0);
  });

  test("validates compliant execution context cleanly", () => {
    const validCtx: DefectRemediationContext = {
      actor: "implementer_lane_7",
      role: "implementer",
      taskId: "task-79",
      state: "validating",
      sessionToken: "tok_live_core_defect-cli-1788679550590-b47ab2",
      scope: ["olt/scripts/src/core/defect-cli-1788679550590-b47ab2.ts"],
      gateCommand: "bun test tests/core/defect-cli-1788679550590-b47ab2.test.ts",
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
