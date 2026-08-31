import { describe, it, expect } from "bun:test";
import {
  auditTaskVerificationEvidence,
  evaluateCounterfactualEvidence,
  validateReviewPushbackInput,
  type TaskVerificationEvidenceInput,
} from "../../../olt/scripts/src/authority/review/index.ts";

describe("Review Pushback - Counterfactuals & Verification Audit", () => {
  it("evaluateCounterfactualEvidence handles non-array and empty inputs", () => {
    const res = evaluateCounterfactualEvidence(undefined, undefined);
    expect(res.isSufficient).toBe(false);
    expect(res.hypothesisCount).toBe(0);
    expect(res.falsificationCheckCount).toBe(0);
  });

  it("evaluateCounterfactualEvidence scores valid hypotheses and falsification checks", () => {
    const res = evaluateCounterfactualEvidence(
      [
        {
          hypothesis: "Task fails if lease token is expired",
          negativeCheck: "bun test tests/authority/grants/singleton-auditor-lease.test.ts",
          falsified: true,
          observation: "Expired lease throws LEASE_EXPIRED",
        },
      ],
      [
        {
          command: "bun test tests/authority/grants/singleton-auditor-lease.test.ts",
          exit_code: 0,
        },
      ],
    );
    expect(res.isSufficient).toBe(true);
    expect(res.hypothesisCount).toBe(1);
  });

  it("auditTaskVerificationEvidence performs complete multi-check validation", () => {
    const input: TaskVerificationEvidenceInput = {
      taskId: "task-100",
      summary: "Implemented in-memory session store with comprehensive test coverage and passed proofs.",
      domainEvidence: {
        "code-quality": { testsPass: true },
        security: { sanitizePath: true },
      },
      counterfactualEvidence: [
        {
          hypothesis: "Tampered state triggers hash check failure",
          negativeCheck: "verifyState()",
          falsified: true,
        },
      ],
      checks: [
        { command: "bun test", exit_code: 0, output: "10 pass" },
      ],
    };

    const audit = auditTaskVerificationEvidence(input, {
      requiredDomains: ["code-quality", "security"],
      requireCounterfactual: true,
    });
    expect(audit.valid).toBe(true);
    expect(audit.superficiality.isSuperficial).toBe(false);
    expect(audit.domainBatching.isBatched).toBe(false);
    expect(audit.counterfactual.isSufficient).toBe(true);
  });

  it("validateReviewPushbackInput validates input payloads strictly", () => {
    expect(() => validateReviewPushbackInput(null)).toThrow();
    expect(() =>
      validateReviewPushbackInput({
        validator_id: "",
        domain: "code-quality",
        cause: "procedural",
        observation: "obs",
        remediation: "rem",
      }),
    ).toThrow();
  });
});
