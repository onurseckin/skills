import { describe, expect, it } from "bun:test";
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
  type PushbackHistory,
  type TaskVerificationEvidenceInput,
} from "../../../orchestrating-long-tasks/scripts/src/authority/review-pushback.ts";
import {
  executeCoordinatorPushback,
  isProceduralPushback,
  isSubstantivePushback,
  validatePushbackEvidence,
  type PushbackContestOptions,
} from "../../../orchestrating-long-tasks/scripts/src/task/pushback.ts";
import { HarnessError } from "../../../orchestrating-long-tasks/scripts/src/errors/harness-error.ts";
import type {
  TransactionPort,
  WorkflowState,
} from "../../../orchestrating-long-tasks/scripts/src/workflow/types.ts";

function createMockTransactionPort(initialState: WorkflowState): TransactionPort {
  let state = structuredClone(initialState);
  return {
    read: () => state,
    transact: <T>(
      _actor: string,
      _action: string,
      _payload: unknown,
      fn: (draft: WorkflowState) => T,
    ): WorkflowState => {
      const draft = structuredClone(state);
      fn(draft);
      state = draft;
      return state;
    },
  };
}

function createValidatedState(
  taskId: string = "task-alpha",
  validatorId: string = "validator-prime",
): WorkflowState {
  return {
    tasks: {
      [taskId]: {
        id: taskId,
        status: "validated",
        requirement_ids: ["REQ-101", "REQ-102"],
        write_scope: ["src/core/feature.ts"],
        dependencies: [],
        attempts: [],
        history: [],
        repair_round: 0,
        original_implementer: "implementer-1",
        validations: [
          {
            validator_id: validatorId,
            domain: "code-quality",
            token_digest: "digest-123",
            attempt: 1,
            started_at: "2026-08-22T10:00:00.000Z",
            deadline_at: "2026-08-22T11:00:00.000Z",
            verdict: "pass",
          },
        ],
      },
    },
  };
}

describe("Strict 1:1 Individual Task Verification Scepticism", () => {
  describe("Superficial Claim Rejection", () => {
    it("rejects generic rubber-stamping phrases without substantive evidence", () => {
      const phrases = [
        "LGTM",
        "looks good to me",
        "all tests pass",
        "tests pass",
        "done",
        "verified",
        "everything works",
        "passed without issues",
        "all requirements met",
        "good to go",
      ];

      for (const phrase of phrases) {
        const result = rejectSuperficialClaims(phrase);
        expect(result.isSuperficial).toBe(true);
        expect(result.reason).not.toBeNull();
        expect(result.confidenceScore).toBeGreaterThanOrEqual(0.7);
      }
    });

    it("rejects empty or whitespace-only claim summaries", () => {
      const emptyResult = rejectSuperficialClaims("   ");
      expect(emptyResult.isSuperficial).toBe(true);
      expect(emptyResult.matchedPatterns).toContain("empty_text");
    });

    it("accepts detailed, task-specific verification claims with concrete evidence", () => {
      const substantiatedClaim =
        "Verified boundary handling in src/core/feature.ts:45-80 with 14 unit test assertions covering edge cases.";
      const result = rejectSuperficialClaims(substantiatedClaim, [
        { kind: "diff", description: "Added null check and defensive guards" },
      ]);
      expect(result.isSuperficial).toBe(false);
      expect(result.reason).toBeNull();
      expect(result.confidenceScore).toBe(0.0);
    });
  });

  describe("Domain Batching Rejection", () => {
    it("detects and rejects multi-domain claims sharing identical duplicate evidence", () => {
      const domains = ["code-quality", "security", "ui-design"] as const;
      const batchedEvidence = {
        "code-quality": { summary: "All checks passed", exit_code: 0 },
        security: { summary: "All checks passed", exit_code: 0 }, // Duplicate payload
        "ui-design": { summary: "All checks passed", exit_code: 0 }, // Duplicate payload
      };

      const result = detectDomainBatching(domains, batchedEvidence);
      expect(result.isBatched).toBe(true);
      expect(result.violatingDomains).toContain("security");
      expect(result.violatingDomains).toContain("ui-design");
      expect(result.reasons.some((r) => r.includes("undifferentiated domain batching"))).toBe(true);
    });

    it("detects and rejects missing or empty evidence for claimed domains", () => {
      const domains = ["code-quality", "system-design"] as const;
      const partialEvidence = {
        "code-quality": { check: "bun test tests/unit/core", output: "pass" },
        "system-design": {},
      };

      const result = detectDomainBatching(domains, partialEvidence);
      expect(result.isBatched).toBe(true);
      expect(result.violatingDomains).toContain("system-design");
    });

    it("accepts distinct, domain-specific evidence for each claimed validator domain", () => {
      const domains = ["code-quality", "security"] as const;
      const segregatedEvidence = {
        "code-quality": {
          astCheck: "eslint --max-warnings=0",
          unitTests: "bun test tests/unit/core",
          complexity: "cyclomatic <= 5",
        },
        security: {
          sastAudit: "semgrep --config=p/security",
          dependencyAudit: "bun audit",
          taintAnalysis: "0 injection vulnerabilities found",
        },
      };

      const result = detectDomainBatching(domains, segregatedEvidence);
      expect(result.isBatched).toBe(false);
      expect(result.violatingDomains).toHaveLength(0);
      expect(result.reasons).toHaveLength(0);
    });
  });

  describe("Counterfactual Falsifiability Evidence", () => {
    it("rejects verification lacking discriminating counterfactual proof when required", () => {
      const result = evaluateCounterfactualEvidence([], []);
      expect(result.isSufficient).toBe(false);
      expect(result.hypothesisCount).toBe(0);
      expect(result.falsificationCheckCount).toBe(0);
    });

    it("accepts verification containing negative test hypotheses or falsification checks", () => {
      const counterfactuals = [
        {
          hypothesis: "Mutating input payload to null causes strict validation error (400)",
          negativeCheck: "bun test tests/negative/invalid-payload.test.ts",
          falsified: true,
          observation: "Gate fails with exit code 1 when guard is removed",
        },
      ];

      const result = evaluateCounterfactualEvidence(counterfactuals);
      expect(result.isSufficient).toBe(true);
      expect(result.hypothesisCount).toBe(1);
      expect(result.falsificationCheckCount).toBe(1);
    });
  });

  describe("Comprehensive Task Verification Audit", () => {
    it("fails audit and recommends pushback when verification is superficial and unsubstantiated", () => {
      const badEvidence: TaskVerificationEvidenceInput = {
        taskId: "task-alpha",
        summary: "looks good",
        checks: [],
        evidence: [],
      };

      const audit = auditTaskVerificationEvidence(badEvidence, {
        requireCounterfactual: true,
      });

      expect(audit.valid).toBe(false);
      expect(audit.scepticismScore).toBeLessThan(50);
      expect(audit.rejectionReasons.length).toBeGreaterThan(0);
      expect(audit.violations.some((v) => v.type === "superficial_claim")).toBe(true);
      expect(audit.violations.some((v) => v.type === "unsubstantiated_verdict")).toBe(true);
      expect(audit.violations.some((v) => v.type === "missing_counterfactual_evidence")).toBe(true);
      expect(audit.correctiveGuidance.length).toBeGreaterThan(0);
    });

    it("fails audit when a check command exits with non-zero code", () => {
      const failingEvidence: TaskVerificationEvidenceInput = {
        taskId: "task-alpha",
        summary: "Executed test suite with detailed logging",
        checks: [
          {
            command: "bun test tests/unit/feature.test.ts",
            status: "failed",
            exit_code: 1,
            output: "AssertionError: expected true but received false",
          },
        ],
      };

      const audit = auditTaskVerificationEvidence(failingEvidence);
      expect(audit.valid).toBe(false);
      expect(audit.violations.some((v) => v.type === "unsubstantiated_verdict")).toBe(true);
      expect(audit.recommendedAction).toBe("pushback_substantive");
    });

    it("passes audit when 1:1 individual verification evidence is robust and substantiated", () => {
      const robustEvidence: TaskVerificationEvidenceInput = {
        taskId: "task-alpha",
        requirementIds: ["REQ-101", "REQ-102"],
        filesChanged: ["src/core/feature.ts", "tests/unit/feature.test.ts"],
        summary:
          "Implemented rate limiting token bucket algorithm in src/core/feature.ts with full branch coverage",
        checks: [
          {
            command: "bun test tests/unit/feature.test.ts",
            command_id: "cmd-test-1",
            status: "passed",
            exit_code: 0,
            output: "12 pass, 0 fail",
          },
        ],
        evidence: [
          {
            kind: "diff",
            description: "Added token bucket capacity check and refill cadence calculation",
          },
        ],
        counterfactualEvidence: [
          {
            hypothesis: "Exceeding rate limit returns 429 Too Many Requests",
            negativeCheck: "bun test tests/unit/rate-limit-exceeded.test.ts",
            falsified: true,
          },
        ],
      };

      const audit = auditTaskVerificationEvidence(robustEvidence, {
        requireCounterfactual: true,
      });

      expect(audit.valid).toBe(true);
      expect(audit.scepticismScore).toBe(100);
      expect(audit.violations).toHaveLength(0);
      expect(audit.rejectionReasons).toHaveLength(0);
      expect(audit.recommendedAction).toBe("accept");
    });
  });
});

describe("Multi-Round Iterative Repair & Pushback Engine (Rounds 1 to 5+)", () => {
  it("tracks pushback iterations from round 1 through round 5+ with full lineage", () => {
    let history = createPushbackHistory("task-iterative", 5);
    expect(history.currentRound).toBe(0);
    expect(history.rounds).toHaveLength(0);
    expect(history.isExhausted).toBe(false);

    // Round 1: Procedural pushback
    history = appendPushbackRound(history, {
      coordinatorId: "coord-1",
      validatorId: "val-1",
      domain: "code-quality",
      cause: "procedural",
      observation: "Pass lacks check command execution proof",
      remediation: "Run unit test suite and record command proof",
      rejectionReasons: ["missing_command_proof"],
    });

    expect(history.currentRound).toBe(1);
    expect(history.rounds).toHaveLength(1);
    expect(history.rounds[0]!.round).toBe(1);
    expect(history.rounds[0]!.cause).toBe("procedural");
    expect(history.rounds[0]!.statusAfter).toBe("validating");
    expect(history.isExhausted).toBe(false);

    // Round 2: Substantive pushback
    history = appendPushbackRound(history, {
      coordinatorId: "coord-1",
      validatorId: "val-2",
      domain: "code-quality",
      cause: "substantive",
      observation: "Edge case in empty queue handling triggers uncaught panic",
      remediation: "Handle empty queue sentinel in queue worker",
      rejectionReasons: ["empty_queue_panic"],
    });

    expect(history.currentRound).toBe(2);
    expect(history.rounds[1]!.round).toBe(2);
    expect(history.rounds[1]!.cause).toBe("substantive");
    expect(history.rounds[1]!.statusAfter).toBe("changes_requested");
    expect(history.isExhausted).toBe(false);

    // Round 3: Substantive pushback
    history = appendPushbackRound(history, {
      coordinatorId: "coord-1",
      validatorId: "val-3",
      domain: "code-quality",
      cause: "substantive",
      observation: "Retry backoff exponential multiplier exceeds max delay threshold",
      remediation: "Cap max delay at 30 seconds",
      rejectionReasons: ["uncapped_backoff_delay"],
    });

    expect(history.currentRound).toBe(3);
    expect(history.rounds[2]!.round).toBe(3);

    // Round 4: Substantive pushback
    history = appendPushbackRound(history, {
      coordinatorId: "coord-1",
      validatorId: "val-4",
      domain: "code-quality",
      cause: "substantive",
      observation: "Memory leak in persistent timer reference",
      remediation: "Clear timeout timer on task cancellation",
      rejectionReasons: ["timer_memory_leak"],
    });

    expect(history.currentRound).toBe(4);
    expect(history.rounds).toHaveLength(4);

    // Round 5: Substantive pushback hitting maxRepairRounds = 5 -> escalation
    history = appendPushbackRound(history, {
      coordinatorId: "coord-1",
      validatorId: "val-5",
      domain: "code-quality",
      cause: "substantive",
      observation: "Persistent failure across 5 iterative rounds",
      remediation: "Manual coordinator intervention required",
      rejectionReasons: ["max_rounds_exhausted"],
    });

    expect(history.currentRound).toBe(5);
    expect(history.rounds).toHaveLength(5);
    expect(history.rounds[4]!.round).toBe(5);
    expect(history.rounds[4]!.statusAfter).toBe("escalated");
    expect(history.isExhausted).toBe(true);
  });

  it("detects stagnant repair submissions that repeat previous evidence without addressing pushback", () => {
    let history = createPushbackHistory("task-stagnant", 3);
    history = appendPushbackRound(history, {
      coordinatorId: "coord-1",
      validatorId: "val-1",
      domain: "code-quality",
      cause: "substantive",
      observation: "Missing validation for negative numbers",
      remediation: "Add guard clause rejecting negative inputs",
      rejectionReasons: ["negative_number_guard_missing"],
      previousEvidenceSummary: "Basic implementation of math helper",
    });

    // Submitting the exact same evidence without addressing rejection reasons
    const stagnantSubmission: TaskVerificationEvidenceInput = {
      taskId: "task-stagnant",
      summary: "Basic implementation of math helper",
      checks: [{ command: "bun test tests/math.test.ts", exit_code: 0 }],
    };

    const evaluation = evaluateRepairProgression(history, stagnantSubmission);
    expect(evaluation.stagnant).toBe(true);
    expect(evaluation.progressMade).toBe(false);
    expect(evaluation.unaddressedReasons).toContain("negative_number_guard_missing");
    expect(evaluation.correctiveGuidance.some((g) => g.includes("stagnant"))).toBe(true);
  });

  it("recognizes progressive repair addressing previous pushback observations", () => {
    let history = createPushbackHistory("task-progress", 3);
    history = appendPushbackRound(history, {
      coordinatorId: "coord-1",
      validatorId: "val-1",
      domain: "code-quality",
      cause: "substantive",
      observation: "Missing validation for negative numbers",
      remediation: "Add guard clause rejecting negative inputs",
      rejectionReasons: ["negative_number_guard_missing"],
      previousEvidenceSummary: "Basic implementation of math helper",
    });

    const progressiveSubmission: TaskVerificationEvidenceInput = {
      taskId: "task-progress",
      summary: "Added negative_number_guard_missing check with defensive throw",
      checks: [
        {
          command: "bun test tests/math-negative_number_guard_missing.test.ts",
          exit_code: 0,
          output: "Negative input throws HarnessError INVALID_ARGUMENT",
        },
      ],
    };

    const evaluation = evaluateRepairProgression(history, progressiveSubmission);
    expect(evaluation.stagnant).toBe(false);
    expect(evaluation.progressMade).toBe(true);
    expect(evaluation.addressedReasons).toContain("negative_number_guard_missing");
    expect(evaluation.unaddressedReasons).toHaveLength(0);
  });

  it("evaluates repair exhaustion against configurable max repair rounds", () => {
    expect(isRepairExhausted(1, 3)).toBe(false);
    expect(isRepairExhausted(2, 3)).toBe(false);
    expect(isRepairExhausted(3, 3)).toBe(true);
    expect(isRepairExhausted(5, 5)).toBe(true);
    expect(isRepairExhausted(6, 5)).toBe(true);
  });

  it("generates comprehensive corrective guidance incorporating multi-round lineage", () => {
    let history = createPushbackHistory("task-guide", 3);
    history = appendPushbackRound(history, {
      coordinatorId: "coord-1",
      validatorId: "val-1",
      domain: "code-quality",
      cause: "substantive",
      observation: "Lock timeout handling does not retry with exponential backoff",
      remediation: "Introduce exponential jitter backoff with max 3 retries",
      correctiveGuidance: ["Use calculateBackoffDelay helper with jitter"],
    });

    const guidance = generateCorrectiveGuidance(history);
    expect(guidance.some((g) => g.includes("Round 1 SUBSTANTIVE Pushback"))).toBe(true);
    expect(guidance.some((g) => g.includes("Lock timeout handling"))).toBe(true);
    expect(guidance.some((g) => g.includes("exponential jitter"))).toBe(true);
  });
});

describe("Review Pushback Authority Validation and Criteria", () => {
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
    expect(() =>
      validateReviewPushbackInput({
        validator_id: "val-99",
        domain: "code-quality",
        cause: "arbitrary_opinion",
        observation: "Test observation",
        remediation: "Test remediation",
      }),
    ).toThrow(/procedural.*substantive/);
  });

  it("refuses unrecognized validator domain", () => {
    expect(() =>
      validateReviewPushbackInput({
        validator_id: "val-99",
        domain: "quantum-physics",
        cause: "procedural",
        observation: "Test observation",
        remediation: "Test remediation",
      }),
    ).toThrow(/recognized validator domain/);
  });

  it("refuses blank observation or blank remediation", () => {
    expect(() =>
      validateReviewPushbackInput({
        validator_id: "val-99",
        domain: "code-quality",
        cause: "substantive",
        observation: "   ",
        remediation: "Fix the code",
      }),
    ).toThrow(HarnessError);

    expect(() =>
      validateReviewPushbackInput({
        validator_id: "val-99",
        domain: "code-quality",
        cause: "substantive",
        observation: "Observation",
        remediation: "",
      }),
    ).toThrow(HarnessError);
  });

  it("validates authority review pushback criteria invariants", () => {
    expect(() =>
      validateReviewPushbackCriteria("", "coordinator-1", {
        validator_id: "val-1",
        domain: "code-quality",
        cause: "procedural",
        observation: "Observation",
        remediation: "Remediation",
      }),
    ).toThrow(HarnessError);

    expect(() =>
      validateReviewPushbackCriteria("task-1", "", {
        validator_id: "val-1",
        domain: "code-quality",
        cause: "procedural",
        observation: "Observation",
        remediation: "Remediation",
      }),
    ).toThrow(HarnessError);
  });
});

describe("Coordinator Pushback Workflow & Scepticism Integration", () => {
  it("executes procedural pushback reopening validation without advancing repair round", () => {
    const initialState = createValidatedState("task-p1", "val-1");
    const port = createMockTransactionPort(initialState);

    const updatedState = executeCoordinatorPushback(port, "task-p1", "coordinator-1", {
      validatorId: "val-1",
      domain: "code-quality",
      cause: "procedural",
      observation: "The validator pass carried no recorded test evidence",
      remediation: "Re-run validation and record command proof before passing",
    });

    const task = updatedState.tasks["task-p1"]!;
    expect(task.status).toBe("validating");
    expect(task.repair_round).toBe(0);
    expect(task.repair_assignee).toBeUndefined();
    expect(task.coordinator_pushbacks).toHaveLength(1);
    expect(task.coordinator_pushbacks[0]!.cause).toBe("procedural");
    expect(task.coordinator_pushbacks[0]!.validator_id).toBe("val-1");
  });

  it("executes substantive pushback transitioning task to changes_requested and reassigning implementer", () => {
    const initialState = createValidatedState("task-p2", "val-1");
    const port = createMockTransactionPort(initialState);

    const updatedState = executeCoordinatorPushback(port, "task-p2", "coordinator-1", {
      validatorId: "val-1",
      domain: "code-quality",
      cause: "substantive",
      observation: "The implementation has a defect in edge case handling",
      remediation: "Fix the defect and add unit test coverage",
    });

    const task = updatedState.tasks["task-p2"]!;
    expect(task.status).toBe("changes_requested");
    expect(task.repair_round).toBe(1);
    expect(task.repair_assignee).toBe("implementer-1");
    expect(task.coordinator_pushbacks).toHaveLength(1);
    expect(task.coordinator_pushbacks[0]!.cause).toBe("substantive");
  });

  it("escalates task when substantive pushback exhausts maxRepairRounds", () => {
    const initialState = createValidatedState("task-p3", "val-1");
    const port = createMockTransactionPort(initialState);

    const updatedState = executeCoordinatorPushback(
      port,
      "task-p3",
      "coordinator-1",
      {
        validatorId: "val-1",
        domain: "code-quality",
        cause: "substantive",
        observation: "Defect unresolved after max repair rounds",
        remediation: "Escalate to coordinator for re-planning",
      },
      undefined,
      1, // Max repair rounds = 1, so round 1 exhausts it
    );

    const task = updatedState.tasks["task-p3"]!;
    expect(task.status).toBe("escalated");
    expect(task.repair_round).toBe(1);
  });

  it("supports contestValidatorVerdict helper with full options", () => {
    const initialState = createValidatedState("task-p4", "val-1");
    const port = createMockTransactionPort(initialState);

    const options: PushbackContestOptions = {
      taskId: "task-p4",
      coordinatorId: "coordinator-1",
      validatorId: "val-1",
      domain: "code-quality",
      cause: "procedural",
      observation: "Contesting standing pass due to lack of discriminating proof",
      remediation: "Provide falsifiable proof",
      guidance: ["Check negative cases"],
      rejectionReasons: ["unsubstantiated_claims"],
    };

    const updatedState = executeCoordinatorPushback(port, options.taskId, options.coordinatorId, {
      validatorId: options.validatorId,
      domain: options.domain,
      cause: options.cause,
      observation: options.observation,
      remediation: options.remediation,
    });

    expect(updatedState.tasks["task-p4"]!.status).toBe("validating");
    expect(isProceduralPushback("procedural")).toBe(true);
    expect(isSubstantivePushback("substantive")).toBe(true);
    expect(() =>
      validatePushbackEvidence("procedural", "Valid observation", "Valid remediation"),
    ).not.toThrow();
  });
});
