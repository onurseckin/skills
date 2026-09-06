import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  EXPECTED_CHARTER_SHA,
  DRIFTED_CHARTER_SHA,
  verifyCharterIntegrity,
} from "../../olt/scripts/src/mind/defect-cli-1788676749030-rqs1gt.ts";

describe("Defect Remediation: defect-cli-1788676749030-rqs1gt", () => {
  test("exports charter metadata and sha constants", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788676749030-rqs1gt");
    expect(ERROR_CODE).toBe("INTEGRITY");
    expect(EXPECTED_CHARTER_SHA).toBe(
      "416a40a6de8a5ede34885ab99624408774015ce81ab2dd373f8c85cea0fca5cc",
    );
    expect(DEFECT_TITLE).toContain("charter sha256 mismatch");
  });

  test("validates matching charter sha cleanly without drift", () => {
    const result = verifyCharterIntegrity({ observedSha: EXPECTED_CHARTER_SHA });
    expect(result.remediated).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.drifted).toBe(false);
    expect(result.errors.length).toBe(0);
  });

  test("detects charter drift on drifted sha and halts execution", () => {
    const result = verifyCharterIntegrity({ observedSha: DRIFTED_CHARTER_SHA });
    expect(result.remediated).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.drifted).toBe(true);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("charter has drifted");
  });
});
