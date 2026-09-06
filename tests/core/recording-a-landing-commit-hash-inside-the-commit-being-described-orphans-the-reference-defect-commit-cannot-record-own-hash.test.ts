import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  validateDefectPreconditions,
  verifyDefectRemediation,
  type DefectRemediationContext,
  type DefectRemediationResult,
} from "../../olt/scripts/src/core/recording-a-landing-commit-hash-inside-the-commit-being-described-orphans-the-reference-defect-commit-cannot-record-own-hash.ts";

describe("Defect Remediation: defect-commit-cannot-record-own-hash", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-commit-cannot-record-own-hash");
    expect(ERROR_CODE).toBe("STATUS_PROTOCOL_ALLOWS_SELF_REFERENTIAL_COMMIT_HASH");
    expect(DEFECT_TITLE.length).toBeGreaterThan(0);
  });

  test("validates compliant execution context cleanly", () => {
    const validCtx: DefectRemediationContext = {
      actor: "implementer_lane_8",
      role: "implementer",
      taskId: "task-16",
      state: "validating",
      sessionToken: "tok_live_core_defect-commit-cannot-record-own-hash",
      scope: [
        "olt/scripts/src/core/recording-a-landing-commit-hash-inside-the-commit-being-described-orphans-the-reference-defect-commit-cannot-record-own-hash.ts",
      ],
      gateCommand:
        "bun test tests/core/recording-a-landing-commit-hash-inside-the-commit-being-described-orphans-the-reference-defect-commit-cannot-record-own-hash.test.ts",
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
