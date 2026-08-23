import { describe, expect, it } from "bun:test";
import {
  isProceduralPushback,
  isSubstantivePushback,
  validatePushbackEvidence,
  type CoordinatorPushbackCause,
} from "../../../olt/scripts/src/task/pushback.ts";
import { HarnessError } from "../../../olt/scripts/src/errors/harness-error.ts";

describe("task subsystem pushback unit tests", () => {
  it("recognizes pushback cause categories", () => {
    expect(isProceduralPushback("procedural")).toBe(true);
    expect(isProceduralPushback("substantive")).toBe(false);
    expect(isSubstantivePushback("substantive")).toBe(true);
    expect(isSubstantivePushback("procedural")).toBe(false);
  });

  it("validates pushback evidence invariants", () => {
    expect(() =>
      validatePushbackEvidence("procedural", "Valid observation", "Valid remediation"),
    ).not.toThrow();

    expect(() =>
      validatePushbackEvidence(
        "invalid_cause" as unknown as CoordinatorPushbackCause,
        "Valid observation",
        "Valid remediation",
      ),
    ).toThrow(HarnessError);

    expect(() => validatePushbackEvidence("procedural", "", "Valid remediation")).toThrow(
      HarnessError,
    );

    expect(() => validatePushbackEvidence("substantive", "Valid observation", "")).toThrow(
      HarnessError,
    );
  });
});
