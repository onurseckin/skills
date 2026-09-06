import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  enforceMindWakeSessionSecurity,
} from "../../olt/scripts/src/mind/defect-cli-1788676877515-lbzrqd.ts";

describe("Defect Remediation: defect-cli-1788676877515-lbzrqd", () => {
  test("exports defect constants correctly", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788676877515-lbzrqd");
    expect(ERROR_CODE).toBe("AUTHENTICATION_FAILURE");
    expect(DEFECT_TITLE.length).toBeGreaterThan(0);
  });

  test("validates caller session with active grant", () => {
    const result = enforceMindWakeSessionSecurity({
      callerActor: "mind",
      sessionToken: "tok_wake_valid_999",
      runGrantActive: true,
    });
    expect(result.remediated).toBe(true);
    expect(result.authorized).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  test("rejects caller without active grant", () => {
    const result = enforceMindWakeSessionSecurity({
      callerActor: "spoofed",
      explicitIdentityFlag: true,
      runGrantActive: false,
    });
    expect(result.remediated).toBe(true);
    expect(result.authorized).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
