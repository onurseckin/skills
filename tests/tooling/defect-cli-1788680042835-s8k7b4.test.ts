import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  validateGateProofForReview,
  type GateReviewValidationContext,
  type GateReviewValidationResult,
} from "../../olt/scripts/src/tooling/defect-cli-1788680042835-s8k7b4.ts";

describe("Defect Remediation: defect-cli-1788680042835-s8k7b4", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788680042835-s8k7b4");
    expect(ERROR_CODE).toBe("INVALID_STATE");
    expect(DEFECT_TITLE.includes("lane-4-optical-reports-and-records")).toBe(
      true,
    );
  });

  test("rejects passing lane-4 when no falsifiable gate:prove proof is recorded", () => {
    const ctx: GateReviewValidationContext = {
      taskName: "lane-4-optical-reports-and-records",
      gateName: "gate-lane-4-optical-reports-and-records",
      gateCommand: "bun scripts/check/cli.ts push --all",
      proofs: [],
    };
    const result: GateReviewValidationResult = validateGateProofForReview(ctx);
    expect(result.remediated).toBe(true);
    expect(result.allowed).toBe(false);
    expect(result.proofRecorded).toBe(false);
    expect(result.errorCode).toBe(ERROR_CODE);
    expect(result.error).toContain(
      "cannot pass lane-4-optical-reports-and-records: no recorded falsifiable gate:prove proof for gate-lane-4-optical-reports-and-records (`bun scripts/check/cli.ts push --all`)",
    );
  });

  test("allows passing when valid falsifiable gate:prove proof exists", () => {
    const ctx: GateReviewValidationContext = {
      taskName: "lane-4-optical-reports-and-records",
      gateName: "gate-lane-4-optical-reports-and-records",
      gateCommand: "bun scripts/check/cli.ts push --all",
      proofs: [
        {
          gateId: "gate-lane-4-optical-reports-and-records",
          command: "bun scripts/check/cli.ts push --all",
          actor: "implementer-04",
          claimedBase: "commit-base-42",
          provenAt: Date.now(),
          isFalsifiable: true,
        },
      ],
    };
    const result: GateReviewValidationResult = validateGateProofForReview(ctx);
    expect(result.remediated).toBe(true);
    expect(result.allowed).toBe(true);
    expect(result.proofRecorded).toBe(true);
    expect(result.error).toBeUndefined();
  });
});
