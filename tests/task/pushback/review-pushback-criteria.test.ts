import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  validateReviewPushbackCriteria,
  validateReviewPushbackInput,
} from "../../../olt/scripts/src/authority/review/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { cleanupVirtualTaskFS, setupVirtualTaskFS } from "../task-fixture.ts";

describe("Review Pushback Authority Validation and Criteria", () => {
  beforeEach(() => {
    setupVirtualTaskFS();
  });

  afterEach(() => {
    cleanupVirtualTaskFS();
  });

  it("validates well-formed pushback input structure", () => {
    const valid = validateReviewPushbackInput({
      validator_id: "val-99",
      domain: "code-quality",
      cause: "procedural",
      observation: "Check output is missing",
      remediation: "Re-run check and provide log output",
      guidance: ["Ensure exit code is recorded"],
      rejection_reasons: ["missing_log_output"],
    });

    expect(valid.validatorId).toBe("val-99");
    expect(valid.domain).toBe("code-quality");
    expect(valid.cause).toBe("procedural");
    expect(valid.observation).toBe("Check output is missing");
    expect(valid.remediation).toBe("Re-run check and provide log output");
    expect(valid.guidance).toEqual(["Ensure exit code is recorded"]);
    expect(valid.rejectionReasons).toEqual(["missing_log_output"]);
  });

  it("refuses invalid pushback cause", () => {
    const base = {
      validator_id: "val-99",
      domain: "code-quality",
      observation: "Obs",
      remediation: "Rem",
    };
    expect(() => validateReviewPushbackInput({ ...base, cause: "arbitrary_opinion" })).toThrow(
      /procedural.*substantive/,
    );
  });

  it("refuses unrecognized validator domain", () => {
    const base = {
      validator_id: "val-99",
      cause: "procedural",
      observation: "Obs",
      remediation: "Rem",
    };
    expect(() => validateReviewPushbackInput({ ...base, domain: "quantum-physics" })).toThrow(
      /recognized validator domain/,
    );
  });

  it("refuses blank observation or blank remediation", () => {
    const base = { validator_id: "val-99", domain: "code-quality", cause: "substantive" };
    expect(() =>
      validateReviewPushbackInput({ ...base, observation: "   ", remediation: "Fix" }),
    ).toThrow(HarnessError);
    expect(() =>
      validateReviewPushbackInput({ ...base, observation: "Obs", remediation: "" }),
    ).toThrow(HarnessError);
  });

  it("validates authority review pushback criteria invariants", () => {
    const valid = {
      validator_id: "val-1",
      domain: "code-quality",
      cause: "procedural",
      observation: "O",
      remediation: "R",
    };
    expect(() => validateReviewPushbackCriteria("", "coordinator-1", valid)).toThrow(HarnessError);
    expect(() => validateReviewPushbackCriteria("task-1", "", valid)).toThrow(HarnessError);
  });
});
