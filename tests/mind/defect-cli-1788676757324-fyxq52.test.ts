import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  evaluateMindPulseAuthority,
} from "../../olt/scripts/src/mind/defect-cli-1788676757324-fyxq52.ts";

describe("Defect Remediation: defect-cli-1788676757324-fyxq52", () => {
  test("exports defect constants correctly", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788676757324-fyxq52");
    expect(ERROR_CODE).toBe("AUTHENTICATION_FAILURE");
    expect(DEFECT_TITLE).toContain("mind:pulse requires a verified caller session");
  });

  test("authorizes verified session with active grant for mind:pulse", () => {
    const result = evaluateMindPulseAuthority({
      callerActor: "mind",
      sessionToken: "tok_pulse_active_777",
      runGrantActive: true,
      pulseId: "pulse-1",
    });
    expect(result.remediated).toBe(true);
    expect(result.authorized).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  test("blocks unverified caller attempting mind:pulse with identity flag", () => {
    const result = evaluateMindPulseAuthority({
      callerActor: "unauthorized_agent",
      explicitIdentityFlag: true,
      runGrantActive: false,
    });
    expect(result.remediated).toBe(true);
    expect(result.authorized).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
