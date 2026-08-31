import { describe, it, expect } from "bun:test";
import {
  SUPERFICIAL_PATTERNS,
  rejectSuperficialClaims,
  detectDomainBatching,
  evaluateCounterfactualEvidence,
  auditTaskVerificationEvidence,
  createPushbackHistory,
  appendPushbackRound,
  evaluateRepairProgression,
  isRepairExhausted,
  generateCorrectiveGuidance,
  validateReviewPushbackInput,
  validateReviewPushbackCriteria,
  type TaskVerificationEvidenceInput,
  type TaskVerificationCheckInput,
  type CounterfactualEvidenceItem,
} from "../../olt/scripts/src/authority/review/index.ts";
import { MAX_REPAIR_ROUNDS } from "../../olt/scripts/src/core/config/contracts.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";

describe("Review Pushback Subsystem (authority/review-pushback.ts)", () => {
  describe("SUPERFICIAL_PATTERNS and rejectSuperficialClaims", () => {
    it("identifies empty or whitespace claims as superficial with max confidence", () => {
      const emptyRes = rejectSuperficialClaims("");
      expect(emptyRes.isSuperficial).toBe(true);
      expect(emptyRes.matchedPatterns).toEqual(["empty_text"]);
      expect(emptyRes.reason).toContain("empty or whitespace");
      expect(emptyRes.confidenceScore).toBe(1.0);

      const whitespaceRes = rejectSuperficialClaims("   \t\n  ");
      expect(whitespaceRes.isSuperficial).toBe(true);
      expect(whitespaceRes.matchedPatterns).toEqual(["empty_text"]);
      expect(whitespaceRes.confidenceScore).toBe(1.0);
    });

    it("matches each regex pattern in SUPERFICIAL_PATTERNS for short vague phrases", () => {
      const testPhrases = [
        "lgtm",
        "looks good",
        "looks fine",
        "looks ok",
        "looks okay",
        "all tests pass",
        "tests pass",
        "all passing",
        "tests green",
        "done",
        "verified",
        "approved",
        "passed",
        "complete",
        "finished",
        "everything works",
        "works as expected",
        "no issues found",
        "no problems",
        "passed without issues",
        "all requirements met",
        "looks good to me",
        "checked and verified",
        "verified manually",
        "good to go",
      ];

      for (const phrase of testPhrases) {
        const res = rejectSuperficialClaims(phrase);
        expect(res.isSuperficial).toBe(true);
        expect(res.matchedPatterns.length).toBeGreaterThan(0);
        expect(res.confidenceScore).toBe(0.95);
        expect(res.reason).toContain(phrase);
      }
    });

    it("evaluates longer phrases matching superficial patterns without evidence", () => {
      const longSuperficial =
        "Looks good to me and everything works fine across all standard modules.";
      expect(longSuperficial.length).toBeGreaterThanOrEqual(25);

      const res = rejectSuperficialClaims(longSuperficial);
      expect(res.isSuperficial).toBe(true);
      expect(res.confidenceScore).toBe(0.75);
      expect(res.reason).toContain("matches superficial pattern");
    });

    it("passes substantive claims with concrete task details and evidence", () => {
      const substantiveClaim =
        "Validated state transition machine for task T-102 and confirmed lease heartbeats renew as expected.";
      const res = rejectSuperficialClaims(substantiveClaim, [{ kind: "test_run", output: "pass" }]);
      expect(res.isSuperficial).toBe(false);
      expect(res.matchedPatterns).toEqual([]);
      expect(res.reason).toBeNull();
      expect(res.confidenceScore).toBe(0.0);
    });

    it("passes long claims with matched patterns when substantive evidence is provided", () => {
      const longPhraseWithEvidence =
        "All requirements met with thorough automated test execution covering edge cases.";
      expect(longPhraseWithEvidence.length).toBeGreaterThanOrEqual(25);
      const res = rejectSuperficialClaims(longPhraseWithEvidence, [{ kind: "log", diff: "+line" }]);
      expect(res.isSuperficial).toBe(false);
      expect(res.confidenceScore).toBe(0.0);
      expect(res.reason).toBeNull();
    });
  });

  describe("detectDomainBatching", () => {
    it("returns not batched when 0 or 1 domain is provided", () => {
      const zeroRes = detectDomainBatching([]);
      expect(zeroRes.isBatched).toBe(false);
      expect(zeroRes.reasons).toEqual([]);
      expect(zeroRes.domainsEvaluated).toEqual([]);
      expect(zeroRes.violatingDomains).toEqual([]);

      const oneRes = detectDomainBatching(["code-quality"], { "code-quality": { passed: true } });
      expect(oneRes.isBatched).toBe(false);
      expect(oneRes.domainsEvaluated).toEqual(["code-quality"]);
      expect(oneRes.violatingDomains).toEqual([]);
    });

    it("detects missing or null domain evidence payloads in multi-domain evaluations", () => {
      const res = detectDomainBatching(["code-quality", "security"], {
        "code-quality": { pass: true },
        security: null,
      });

      expect(res.isBatched).toBe(true);
      expect(res.violatingDomains).toContain("security");
      expect(
        res.reasons.some((r) => r.includes("without dedicated domain-specific evidence")),
      ).toBe(true);
    });

    it("detects empty serialized evidence payloads ({}, [], empty string)", () => {
      const res1 = detectDomainBatching(["code-quality", "security"], {
        "code-quality": {},
        security: { audit: "ok" },
      });
      expect(res1.isBatched).toBe(true);
      expect(res1.violatingDomains).toContain("code-quality");
      expect(res1.reasons.some((r) => r.includes("has empty evidence payload"))).toBe(true);

      const res2 = detectDomainBatching(["system-design", "product"], {
        "system-design": [],
        product: "",
      });
      expect(res2.isBatched).toBe(true);
      expect(res2.violatingDomains).toEqual(["system-design", "product"]);
    });

    it("detects identical duplicate evidence payloads across different domains", () => {
      const sharedEvidence = { passed: true, score: 100 };
      const res = detectDomainBatching(["code-quality", "security", "system-design"], {
        "code-quality": sharedEvidence,
        security: sharedEvidence,
        "system-design": { distinct: "spec-checked" },
      });

      expect(res.isBatched).toBe(true);
      expect(res.violatingDomains).toContain("security");
      expect(
        res.reasons.some((r) => r.includes("shares identical duplicate evidence payload")),
      ).toBe(true);
    });

    it("passes when all domains have distinct, non-empty evidence payloads", () => {
      const res = detectDomainBatching(["code-quality", "security"], {
        "code-quality": { lint: "clean", format: "ok" },
        security: { vulnerability_scan: "0 findings" },
      });

      expect(res.isBatched).toBe(false);
      expect(res.violatingDomains).toEqual([]);
      expect(res.reasons).toEqual([]);
    });
  });

  describe("evaluateCounterfactualEvidence", () => {
    it("handles non-array or undefined inputs gracefully", () => {
      const res = evaluateCounterfactualEvidence(undefined, undefined);
      expect(res.isSufficient).toBe(false);
      expect(res.hypothesisCount).toBe(0);
      expect(res.falsificationCheckCount).toBe(0);
      expect(res.details).toContain("No discriminating counterfactual");
    });

    it("counts valid hypothesis and negative check items in counterfactuals array", () => {
      const items: CounterfactualEvidenceItem[] = [
        {
          hypothesis: "Task fails if lease token is expired",
          negativeCheck: "bun test tests/unit/lease-expiry.test.ts",
          falsified: true,
          observation: "Expired lease throws LEASE_EXPIRED",
        },
        {
          hypothesis: "   ",
          negativeCheck: "   ",
        },
      ];

      const res = evaluateCounterfactualEvidence(items);
      expect(res.isSufficient).toBe(true);
      expect(res.hypothesisCount).toBe(1);
      expect(res.falsificationCheckCount).toBe(1);
      expect(res.details).toContain("Counterfactual evidence verified with 1 hypothesis(es)");
    });

    it("detects falsification checks in command and output fields of checks array", () => {
      const checks: TaskVerificationCheckInput[] = [
        { command: "bun test --falsification", output: "fail on negative check", exit_code: 0 },
        { command: "bun test normal", output: "counterfactual condition confirmed", exit_code: 0 },
        { command: "bun test", output: "all ok", exit_code: 0 },
      ];

      const res = evaluateCounterfactualEvidence([], checks);
      expect(res.isSufficient).toBe(true);
      expect(res.falsificationCheckCount).toBe(2);
    });

    it("handles items with non-object elements in counterfactuals array", () => {
      const items = ["invalid", null, 123, { hypothesis: "Hypothesis 1", falsified: true }];
      const res = evaluateCounterfactualEvidence(items);
      expect(res.isSufficient).toBe(true);
      expect(res.hypothesisCount).toBe(1);
      expect(res.falsificationCheckCount).toBe(1);
    });
  });

  describe("auditTaskVerificationEvidence", () => {
    it("rejects evidence missing task ID", () => {
      const evidence: TaskVerificationEvidenceInput = {
        taskId: "",
        summary: "Verified task successfully",
      };

      const res = auditTaskVerificationEvidence(evidence);
      expect(res.valid).toBe(false);
      expect(res.violations.some((v) => v.type === "empty_rationale")).toBe(true);
      expect(res.rejectionReasons).toContain("Missing task ID in verification claim.");
    });

    it("rejects evidence with superficial summary claim", () => {
      const evidence: TaskVerificationEvidenceInput = {
        taskId: "TASK-1",
        summary: "LGTM",
        checks: [{ command: "bun test", exit_code: 0 }],
      };

      const res = auditTaskVerificationEvidence(evidence);
      expect(res.valid).toBe(false);
      expect(res.violations.some((v) => v.type === "superficial_claim")).toBe(true);
      expect(res.recommendedAction).toBe("pushback_procedural");
      expect(res.correctiveGuidance.length).toBeGreaterThan(0);
    });

    it("rejects evidence with domain batching violations", () => {
      const evidence: TaskVerificationEvidenceInput = {
        taskId: "TASK-2",
        summary: "Substantive summary describing concrete verification of changes.",
        checks: [{ command: "bun test", exit_code: 0 }],
        domainEvidence: {
          "code-quality": { test: "passed" },
          security: { test: "passed" },
        },
      };

      const res = auditTaskVerificationEvidence(evidence, {
        requiredDomains: ["code-quality", "security"],
      });

      expect(res.valid).toBe(false);
      expect(res.violations.some((v) => v.type === "domain_batching")).toBe(true);
    });

    it("enforces requireCounterfactual option when counterfactual evidence is missing", () => {
      const evidence: TaskVerificationEvidenceInput = {
        taskId: "TASK-3",
        summary: "Substantive verification description with clear file references.",
        checks: [{ command: "bun test tests/unit/foo.test.ts", exit_code: 0 }],
      };

      const res = auditTaskVerificationEvidence(evidence, {
        requireCounterfactual: true,
      });

      expect(res.valid).toBe(false);
      expect(res.violations.some((v) => v.type === "missing_counterfactual_evidence")).toBe(true);
      expect(
        res.rejectionReasons.some((r) => r.includes("counterfactual falsification proof")),
      ).toBe(true);
    });

    it("flags unsubstantiated verdict when neither checks nor evidence items are provided", () => {
      const evidence: TaskVerificationEvidenceInput = {
        taskId: "TASK-4",
        summary: "Concrete statement of work without any attached test executions.",
      };

      const res = auditTaskVerificationEvidence(evidence);
      expect(res.valid).toBe(false);
      expect(res.violations.some((v) => v.type === "unsubstantiated_verdict")).toBe(true);
      expect(res.recommendedAction).toBe("pushback_substantive");
    });

    it("flags failing checks with non-zero exit codes as substantive pushback", () => {
      const evidence: TaskVerificationEvidenceInput = {
        taskId: "TASK-5",
        summary: "Concrete statement of verification with failing command execution.",
        checks: [
          { command: "bun test", exit_code: 1 },
          { command_id: "cmd-2", exit_code: 2 },
          { exit_code: 3 },
        ],
      };

      const res = auditTaskVerificationEvidence(evidence);
      expect(res.valid).toBe(false);
      expect(res.violations.filter((v) => v.type === "unsubstantiated_verdict").length).toBe(3);
      expect(res.recommendedAction).toBe("pushback_substantive");
    });

    it("passes fully substantiated evidence with 100 scepticism score and accept recommendation", () => {
      const evidence: TaskVerificationEvidenceInput = {
        taskId: "TASK-6",
        summary: "Implemented strict validation guard and covered 100% of branches with bun test.",
        checks: [
          {
            command: "bun test tests/unit/guard.test.ts",
            output: "pass 12/12 negative and counterfactual checks",
            exit_code: 0,
          },
        ],
        evidence: [{ kind: "test_output", data: "all green" }],
        counterfactualEvidence: [
          {
            hypothesis: "Fails when invalid role token is passed",
            negativeCheck: "bun test --filter=invalid-token",
            falsified: true,
          },
        ],
        domainEvidence: {
          "code-quality": { lintPassed: true },
        },
      };

      const res = auditTaskVerificationEvidence(evidence, {
        requireCounterfactual: true,
        requiredDomains: ["code-quality"],
      });

      expect(res.valid).toBe(true);
      expect(res.scepticismScore).toBe(100);
      expect(res.violations).toEqual([]);
      expect(res.rejectionReasons).toEqual([]);
      expect(res.recommendedAction).toBe("accept");
    });
  });

  describe("createPushbackHistory and appendPushbackRound", () => {
    it("initializes pushback history with defaults", () => {
      const history = createPushbackHistory("TASK-100");
      expect(history.taskId).toBe("TASK-100");
      expect(history.currentRound).toBe(0);
      expect(history.maxRepairRounds).toBe(MAX_REPAIR_ROUNDS);
      expect(history.rounds).toEqual([]);
      expect(history.isExhausted).toBe(false);
      expect(history.unresolvedRejectionReasons).toEqual([]);
    });

    it("initializes pushback history with custom maxRepairRounds", () => {
      const history = createPushbackHistory("TASK-101", 3);
      expect(history.maxRepairRounds).toBe(3);
    });

    it("appends rounds and calculates default statusAfter and exhaustion correctly", () => {
      const h0 = createPushbackHistory("TASK-102", 2);

      // Round 1: Procedural pushback
      const h1 = appendPushbackRound(h0, {
        coordinatorId: "coord-1",
        validatorId: "val-1",
        domain: "code-quality",
        cause: "procedural",
        observation: "Missing test command execution outputs.",
        remediation: "Execute bun test and attach exit code.",
      });

      expect(h1.currentRound).toBe(1);
      expect(h1.rounds.length).toBe(1);
      expect(h1.rounds[0]?.statusAfter).toBe("validating");
      expect(h1.rounds[0]?.id).toContain("cpb-TASK-102-r1");
      expect(h1.isExhausted).toBe(false);
      expect(h1.lastCause).toBe("procedural");

      // Round 2: Substantive pushback reaching maxRepairRounds (exhausted -> escalated)
      const h2 = appendPushbackRound(h1, {
        coordinatorId: "coord-1",
        validatorId: "val-1",
        domain: "code-quality",
        cause: "substantive",
        observation: "Logic flaw in error boundary.",
        remediation: "Fix catch handler to wrap unknown errors in HarnessError.",
        rejectionReasons: ["Unhandled error type"],
        correctiveGuidance: ["Use HarnessError.from(err)"],
        previousEvidenceDigest: "sha256-hash-1",
        previousEvidenceSummary: "Previous summary text",
      });

      expect(h2.currentRound).toBe(2);
      expect(h2.rounds.length).toBe(2);
      expect(h2.rounds[1]?.statusAfter).toBe("escalated");
      expect(h2.isExhausted).toBe(true);
      expect(h2.lastCause).toBe("substantive");
      expect(h2.unresolvedRejectionReasons).toEqual(["Unhandled error type"]);
      expect(h2.rounds[1]?.previousEvidenceDigest).toBe("sha256-hash-1");
      expect(h2.rounds[1]?.previousEvidenceSummary).toBe("Previous summary text");
    });

    it("appends rounds with explicit round, timestamp, and statusAfter", () => {
      const h0 = createPushbackHistory("TASK-103", 5);
      const h1 = appendPushbackRound(h0, {
        round: 4,
        timestamp: "2026-08-24T00:00:00.000Z",
        coordinatorId: "coord-1",
        validatorId: "val-1",
        domain: "security",
        cause: "substantive",
        observation: "Observation",
        remediation: "Remediation",
        statusAfter: "changes_requested",
      });

      expect(h1.currentRound).toBe(4);
      expect(h1.rounds[0]?.timestamp).toBe("2026-08-24T00:00:00.000Z");
      expect(h1.rounds[0]?.statusAfter).toBe("changes_requested");
      expect(h1.isExhausted).toBe(false);
    });

    it("sets statusAfter to changes_requested when substantive pushback is below maxRepairRounds", () => {
      const h0 = createPushbackHistory("TASK-104", 5);
      const h1 = appendPushbackRound(h0, {
        coordinatorId: "coord-1",
        validatorId: "val-1",
        domain: "code-quality",
        cause: "substantive",
        observation: "Typo in variable name",
        remediation: "Rename to canonical identifier",
      });

      expect(h1.rounds[0]?.statusAfter).toBe("changes_requested");
    });
  });

  describe("evaluateRepairProgression", () => {
    it("returns progressMade=true and stagnant=false when history has no rounds", () => {
      const history = createPushbackHistory("TASK-200");
      const evalRes = evaluateRepairProgression(history, {
        taskId: "TASK-200",
        summary: "First attempt",
      });

      expect(evalRes.progressMade).toBe(true);
      expect(evalRes.stagnant).toBe(false);
      expect(evalRes.addressedReasons).toEqual([]);
      expect(evalRes.unaddressedReasons).toEqual([]);
      expect(evalRes.correctiveGuidance).toEqual([]);
    });

    it("detects stagnant repair loop when summary is unchanged and rejection reasons unaddressed", () => {
      const h0 = createPushbackHistory("TASK-201");
      const h1 = appendPushbackRound(h0, {
        coordinatorId: "coord-1",
        validatorId: "val-1",
        domain: "code-quality",
        cause: "substantive",
        observation: "Missing null checks in resolver",
        remediation: "Add null check",
        rejectionReasons: ["null pointer dereference", "missing regression test"],
        previousEvidenceSummary: "Fixed resolver logic",
      });

      const stagnantEvidence: TaskVerificationEvidenceInput = {
        taskId: "TASK-201",
        summary: "Fixed resolver logic", // Unchanged summary
        checks: [{ command: "bun test unrelated.ts", output: "pass" }],
      };

      const evalRes = evaluateRepairProgression(h1, stagnantEvidence);
      expect(evalRes.stagnant).toBe(true);
      expect(evalRes.progressMade).toBe(false);
      expect(evalRes.unaddressedReasons).toEqual([
        "null pointer dereference",
        "missing regression test",
      ]);
      expect(evalRes.correctiveGuidance.some((g) => g.includes("is stagnant"))).toBe(true);
      expect(evalRes.diffSummary).toContain("Addressed 0/2 reason(s)");
    });

    it("detects addressed rejection reasons in new summary and check commands", () => {
      const h0 = createPushbackHistory("TASK-202");
      const h1 = appendPushbackRound(h0, {
        coordinatorId: "coord-1",
        validatorId: "val-1",
        domain: "code-quality",
        cause: "substantive",
        observation: "Observation",
        remediation: "Remediation",
        rejectionReasons: ["null pointer dereference", "missing regression test"],
        previousEvidenceSummary: "Initial broken implementation",
      });

      const updatedEvidence: TaskVerificationEvidenceInput = {
        taskId: "TASK-202",
        summary: "Resolved null pointer dereference by introducing guard check.",
        checks: [
          {
            command: "bun test tests/unit/regression.test.ts",
            output: "Resolved missing regression test and all pass",
            exit_code: 0,
          },
        ],
      };

      const evalRes = evaluateRepairProgression(h1, updatedEvidence);
      expect(evalRes.stagnant).toBe(false);
      expect(evalRes.progressMade).toBe(true);
      expect(evalRes.addressedReasons).toEqual([
        "null pointer dereference",
        "missing regression test",
      ]);
      expect(evalRes.unaddressedReasons).toEqual([]);
      expect(evalRes.diffSummary).toContain("Addressed 2/2 reason(s)");
    });
  });

  describe("isRepairExhausted", () => {
    it("returns true if round >= maxRounds, false otherwise", () => {
      expect(isRepairExhausted(4, 5)).toBe(false);
      expect(isRepairExhausted(5, 5)).toBe(true);
      expect(isRepairExhausted(6, 5)).toBe(true);
      expect(isRepairExhausted(MAX_REPAIR_ROUNDS)).toBe(true);
      expect(isRepairExhausted(MAX_REPAIR_ROUNDS - 1)).toBe(false);
    });
  });

  describe("generateCorrectiveGuidance", () => {
    it("generates combined deduplicated guidance from history and audit results", () => {
      const h0 = createPushbackHistory("TASK-300");
      const h1 = appendPushbackRound(h0, {
        coordinatorId: "coord-1",
        validatorId: "val-1",
        domain: "code-quality",
        cause: "substantive",
        observation: "Missing validation schema",
        remediation: "Add Zod or custom schema",
        correctiveGuidance: ["Define schema in schema.ts", "Add schema unit tests"],
      });

      const auditResult = auditTaskVerificationEvidence({
        taskId: "TASK-300",
        summary: "LGTM",
      });

      const guidance = generateCorrectiveGuidance(h1, auditResult);
      expect(guidance.some((g) => g.includes("[Round 1 SUBSTANTIVE Pushback]"))).toBe(true);
      expect(
        guidance.some((g) => g.includes("Remediation Required: Add Zod or custom schema")),
      ).toBe(true);
      expect(guidance.some((g) => g.includes("Define schema in schema.ts"))).toBe(true);
      expect(guidance.some((g) => g.includes("Resolve rejection reason:"))).toBe(true);
    });

    it("handles empty history and undefined auditResult gracefully", () => {
      const history = createPushbackHistory("TASK-301");
      const guidance = generateCorrectiveGuidance(history, undefined);
      expect(guidance).toEqual([]);
    });
  });

  describe("validateReviewPushbackInput and validateReviewPushbackCriteria", () => {
    it("throws HarnessError when input is not an object or is null/array", () => {
      expect(() => validateReviewPushbackInput(null)).toThrow(HarnessError);
      expect(() => validateReviewPushbackInput("string")).toThrow(HarnessError);
      expect(() => validateReviewPushbackInput([1, 2, 3])).toThrow(HarnessError);
      expect(() => validateReviewPushbackInput(undefined)).toThrow(HarnessError);
    });

    it("throws HarnessError when validator_id is missing or whitespace", () => {
      expect(() =>
        validateReviewPushbackInput({
          validator_id: "   ",
          domain: "code-quality",
          cause: "procedural",
          observation: "obs",
          remediation: "rem",
        }),
      ).toThrow(HarnessError);
    });

    it("throws HarnessError when domain is invalid", () => {
      expect(() =>
        validateReviewPushbackInput({
          validator_id: "val-1",
          domain: "invalid-domain",
          cause: "procedural",
          observation: "obs",
          remediation: "rem",
        }),
      ).toThrow(HarnessError);
    });

    it("throws HarnessError when cause is invalid", () => {
      expect(() =>
        validateReviewPushbackInput({
          validator_id: "val-1",
          domain: "code-quality",
          cause: "invalid-cause",
          observation: "obs",
          remediation: "rem",
        }),
      ).toThrow(HarnessError);
    });

    it("throws HarnessError when observation is missing or whitespace", () => {
      expect(() =>
        validateReviewPushbackInput({
          validator_id: "val-1",
          domain: "code-quality",
          cause: "procedural",
          observation: "   ",
          remediation: "rem",
        }),
      ).toThrow(HarnessError);
    });

    it("throws HarnessError when remediation is missing or whitespace", () => {
      expect(() =>
        validateReviewPushbackInput({
          validator_id: "val-1",
          domain: "code-quality",
          cause: "procedural",
          observation: "obs",
          remediation: "   ",
        }),
      ).toThrow(HarnessError);
    });

    it("successfully validates input using camelCase or snake_case fields and default maxRepairRounds", () => {
      const validated1 = validateReviewPushbackInput({
        validatorId: "val-1",
        domain: "security",
        cause: "substantive",
        observation: "Missing permission check",
        remediation: "Add assertAllowedWritePath call",
        guidance: ["Follow root hygiene guard pattern", "   "],
        rejection_reasons: ["Permission denied bypass possible", "  "],
      });

      expect(validated1.validatorId).toBe("val-1");
      expect(validated1.domain).toBe("security");
      expect(validated1.cause).toBe("substantive");
      expect(validated1.observation).toBe("Missing permission check");
      expect(validated1.remediation).toBe("Add assertAllowedWritePath call");
      expect(validated1.guidance).toEqual(["Follow root hygiene guard pattern"]);
      expect(validated1.rejectionReasons).toEqual(["Permission denied bypass possible"]);
      expect(validated1.maxRepairRounds).toBe(MAX_REPAIR_ROUNDS);

      const validated2 = validateReviewPushbackInput({
        validator_id: "val-2",
        domain: "product",
        cause: "procedural",
        observation: "Need test coverage report",
        remediation: "Run bun test --coverage",
        max_repair_rounds: 3,
      });
      expect(validated2.maxRepairRounds).toBe(3);

      const validated3 = validateReviewPushbackInput({
        validator_id: "val-3",
        domain: "system-design",
        cause: "procedural",
        observation: "Need test coverage report",
        remediation: "Run bun test --coverage",
        maxRepairRounds: 4,
      });
      expect(validated3.maxRepairRounds).toBe(4);
    });

    it("validateReviewPushbackCriteria validates taskId and coordinatorId", () => {
      const validInput = {
        validatorId: "val-1",
        domain: "code-quality",
        cause: "procedural",
        observation: "Obs",
        remediation: "Rem",
      };

      expect(() => validateReviewPushbackCriteria("", "coord-1", validInput)).toThrow(HarnessError);
      expect(() => validateReviewPushbackCriteria("   ", "coord-1", validInput)).toThrow(
        HarnessError,
      );
      expect(() => validateReviewPushbackCriteria("TASK-1", "", validInput)).toThrow(HarnessError);
      expect(() => validateReviewPushbackCriteria("TASK-1", "   ", validInput)).toThrow(
        HarnessError,
      );

      expect(() => validateReviewPushbackCriteria("TASK-1", "coord-1", validInput)).not.toThrow();
    });
  });
});
