import { afterEach, beforeEach, describe, expect, it } from "bun:test";
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
} from "../../../olt/scripts/src/authority/review/index.ts";
import {
  recordCoordinatorPushback,
  validateCoordinatorPushbackInput,
} from "../../../olt/scripts/src/workflow/review/coordinator-pushback.ts";
import { isCoordinatorPushbackCause } from "../../../olt/scripts/src/core/contracts/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import type { TransactionPort, WorkflowState } from "../../../olt/scripts/src/workflow/types.ts";
import { cleanupVirtualTaskFS, setupVirtualTaskFS } from "../task-fixture.ts";

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
  beforeEach(() => {
    setupVirtualTaskFS();
  });

  afterEach(() => {
    cleanupVirtualTaskFS();
  });

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
        expect(result.reasons.some((r) => r.includes("undifferentiated domain batching"))).toBe(
          true,
        );
      });

      it("detects and rejects missing or empty evidence for claimed domains", () => {
        const domains = ["code-quality", "system-design"] as const;
        const partialEvidence = {
          "code-quality": { check: "bun test tests/core", output: "pass" },
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
            unitTests: "bun test tests/core",
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
        expect(audit.violations.some((v) => v.type === "missing_counterfactual_evidence")).toBe(
          true,
        );
        expect(audit.correctiveGuidance.length).toBeGreaterThan(0);
      });

      it("fails audit when a check command exits with non-zero code", () => {
        const failingEvidence: TaskVerificationEvidenceInput = {
          taskId: "task-alpha",
          summary: "Executed test suite with detailed logging",
          checks: [
            {
              command: "bun test tests/feature.test.ts",
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
          filesChanged: ["src/core/feature.ts", "tests/feature.test.ts"],
          summary:
            "Implemented rate limiting token bucket algorithm in src/core/feature.ts with full branch coverage",
          checks: [
            {
              command: "bun test tests/feature.test.ts",
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
              negativeCheck: "bun test tests/rate-limit-exceeded.test.ts",
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
});
