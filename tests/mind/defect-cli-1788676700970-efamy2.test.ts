import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  evaluateMindWakeAuthority,
  type MindWakeSessionContext,
} from "../../olt/scripts/src/mind/defect-cli-1788676700970-efamy2.ts";

describe("Defect Remediation: defect-cli-1788676700970-efamy2", () => {
  test("exports defect constants cleanly", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788676700970-efamy2");
    expect(ERROR_CODE).toBe("AUTHENTICATION_FAILURE");
    expect(DEFECT_TITLE).toContain("mind:wake requires a verified caller session");
  });

  test("authorizes verified caller session backed by active run grant", () => {
    const validCtx: MindWakeSessionContext = {
      callerActor: "mind-gen-1",
      sessionToken: "tok_verified_mind_active_12345",
      runGrantActive: true,
      runId: "run-mind-1",
    };
    const result = evaluateMindWakeAuthority(validCtx);
    expect(result.remediated).toBe(true);
    expect(result.authorized).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  test("rejects caller relying on explicit identity flag without active grant", () => {
    const invalidCtx: MindWakeSessionContext = {
      callerActor: "spoofed_actor",
      explicitIdentityFlag: true,
      runGrantActive: false,
    };
    const result = evaluateMindWakeAuthority(invalidCtx);
    expect(result.remediated).toBe(true);
    expect(result.authorized).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
