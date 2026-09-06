import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  auditMindWakeSessionGrant,
} from "../../olt/scripts/src/mind/defect-cli-1788676761282-n4wvrx.ts";

describe("Defect Remediation: defect-cli-1788676761282-n4wvrx", () => {
  test("exports defect constants correctly", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788676761282-n4wvrx");
    expect(ERROR_CODE).toBe("AUTHENTICATION_FAILURE");
    expect(DEFECT_TITLE.length).toBeGreaterThan(0);
  });

  test("validates caller session with active grant", () => {
    const result = auditMindWakeSessionGrant({
      callerActor: "mind",
      sessionToken: "tok_wake_valid_888",
      runGrantActive: true,
    });
    expect(result.remediated).toBe(true);
    expect(result.authorized).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  test("rejects invalid session with authentication error", () => {
    const result = auditMindWakeSessionGrant({
      callerActor: "spoofed",
      explicitIdentityFlag: true,
      runGrantActive: false,
    });
    expect(result.remediated).toBe(true);
    expect(result.authorized).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
