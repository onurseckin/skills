import { describe, expect, test } from "bun:test";
import {
  appendPushbackRound,
  auditTaskVerificationEvidence,
  createPushbackHistory,
  detectDomainBatching,
  evaluateCounterfactualEvidence,
  evaluateRepairProgression,
  generateCorrectiveGuidance,
  isRepairExhausted,
  rejectSuperficialClaims,
  validateReviewPushbackCriteria,
  validateReviewPushbackInput,
  type CounterfactualEvidenceItem,
  type TaskVerificationEvidenceInput,
} from "../../../olt/scripts/src/authority/review/index.ts";

describe("Authority Review Audit, Evaluators, History and Validation Comprehensive", () => {
  test("appendPushbackRound with all optional metadata and statusAfter branches", () => {
    const history = createPushbackHistory("task-100", 3);
    expect(history.currentRound).toBe(0);
    expect(history.isExhausted).toBe(false);

    const h1 = appendPushbackRound(history, {
      coordinatorId: "coordinator_1",
      validatorId: "validator_1",
      domain: "code-quality",
      cause: "procedural",
      observation: "Missing test evidence",
      remediation: "Run tests with coverage",
    });
    expect(h1.currentRound).toBe(1);
    expect(h1.rounds[0]?.statusAfter).toBe("validating");
    expect(h1.isExhausted).toBe(false);

    const h2 = appendPushbackRound(h1, {
      round: 3,
      timestamp: "2026-08-31T00:00:00Z",
      coordinatorId: "coordinator_1",
      validatorId: "validator_1",
      domain: "code-quality",
      cause: "substantive",
      observation: "Test failure confirmed",
      remediation: "Fix source implementation",
      rejectionReasons: ["Assertion error on line 42"],
      previousEvidenceDigest: "sha256:abc12345",
      previousEvidenceSummary: "Evidence digest summary",
      correctiveGuidance: ["Fix bug"],
      statusAfter: "escalated",
    });
    expect(h2.currentRound).toBe(3);
    expect(h2.isExhausted).toBe(true);
    expect(h2.rounds[1]?.previousEvidenceDigest).toBe("sha256:abc12345");
  });

  test("validateReviewPushbackInput validation failures across all fields", () => {
    expect(() => validateReviewPushbackInput(null)).toThrow(
      "coordinator pushback must be an object",
    );
    expect(() => validateReviewPushbackInput([])).toThrow("coordinator pushback must be an object");

    expect(() =>
      validateReviewPushbackInput({
        validator_id: "",
        domain: "code-quality",
        cause: "substantive",
        observation: "obs",
        remediation: "rem",
      }),
    ).toThrow("validator_id is required");

    expect(() =>
      validateReviewPushbackInput({
        validator_id: "val-1",
        domain: "invalid-domain",
        cause: "substantive",
        observation: "obs",
        remediation: "rem",
      }),
    ).toThrow("recognized validator domain");

    expect(() =>
      validateReviewPushbackInput({
        validator_id: "val-1",
        domain: "code-quality",
        cause: "invalid-cause",
        observation: "obs",
        remediation: "rem",
      }),
    ).toThrow("cause must be 'procedural'");

    expect(() =>
      validateReviewPushbackInput({
        validator_id: "val-1",
        domain: "code-quality",
        cause: "substantive",
        observation: "   ",
        remediation: "rem",
      }),
    ).toThrow("non-empty observation");

    expect(() =>
      validateReviewPushbackInput({
        validator_id: "val-1",
        domain: "code-quality",
        cause: "substantive",
        observation: "obs",
        remediation: "   ",
      }),
    ).toThrow("non-empty remediation plan");

    const validated = validateReviewPushbackInput({
      validatorId: "val-1",
      domain: "code-quality",
      cause: "procedural",
      observation: "obs",
      remediation: "rem",
      guidance: ["g1", " "],
      rejection_reasons: ["r1", " "],
      maxRepairRounds: 5,
    });
    expect(validated.validatorId).toBe("val-1");
    expect(validated.guidance).toEqual(["g1"]);
    expect(validated.rejectionReasons).toEqual(["r1"]);
    expect(validated.maxRepairRounds).toBe(5);
  });

  test("auditTaskVerificationEvidence comprehensive evaluation", () => {
    const evidence: TaskVerificationEvidenceInput = {
      taskId: "task-abc",
      checks: [
        {
          command: "bun test",
          status: "passed",
          output: "100 passed",
          exit_code: 0,
        },
      ],
      counterfactualEvidence: [
        {
          hypothesis: "Hypothesis 1",
          negativeCheck: "Failed on type error",
          falsified: true,
          observation: "Obs",
        },
      ],
      summary: "Comprehensive test pass with quantitative proof metrics and zero defects.",
    };

    const audit = auditTaskVerificationEvidence(evidence);
    expect(audit.valid).toBe(true);
    expect(audit.violations.length).toBe(0);

    const superficialEvidence: TaskVerificationEvidenceInput = {
      taskId: "task-abc",
      summary: "looks good to me",
    };
    const superficialAudit = auditTaskVerificationEvidence(superficialEvidence);
    expect(superficialAudit.valid).toBe(false);
    expect(superficialAudit.superficiality.isSuperficial).toBe(true);
  });

  test("detectDomainBatching, evaluateCounterfactualEvidence, and evaluateRepairProgression", () => {
    expect(detectDomainBatching(["code-quality"], {}).isBatched).toBe(false);

    const counterfactuals: CounterfactualEvidenceItem[] = [
      {
        hypothesis: "hyp",
        negativeCheck: "neg proof",
        falsified: true,
        observation: "obs",
      },
    ];
    const cfEval = evaluateCounterfactualEvidence(counterfactuals);
    expect(cfEval.isSufficient).toBe(true);
    expect(cfEval.hypothesisCount).toBe(1);

    const progression = evaluateRepairProgression(
      {
        taskId: "task-100",
        currentRound: 2,
        maxRepairRounds: 3,
        rounds: [],
        isExhausted: false,
        unresolvedRejectionReasons: [],
      },
      { taskId: "task-100", summary: "New evidence summary" },
    );
    expect(progression.stagnant).toBe(false);
    expect(progression.progressMade).toBe(true);

    expect(isRepairExhausted(3, 3)).toBe(true);
    expect(isRepairExhausted(1, 3)).toBe(false);

    const guidance = generateCorrectiveGuidance(
      {
        taskId: "task-100",
        currentRound: 1,
        maxRepairRounds: 3,
        rounds: [
          {
            round: 1,
            id: "cpb-1",
            timestamp: "2026-08-31T00:00:00Z",
            coordinatorId: "coord-1",
            validatorId: "val-1",
            domain: "code-quality",
            cause: "procedural",
            observation: "Missing test coverage",
            remediation: "Add tests",
            rejectionReasons: ["Coverage below 100%"],
            correctiveGuidance: ["Add missing tests"],
            statusAfter: "validating",
          },
        ],
        isExhausted: false,
        unresolvedRejectionReasons: [],
      },
      undefined,
    );
    expect(guidance.length).toBeGreaterThan(0);
  });
});
