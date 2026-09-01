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
} from "../../../olt/scripts/src/authority/review/index.ts";
import {
  recordCoordinatorPushback,
  validateCoordinatorPushbackInput,
} from "../../../olt/scripts/src/workflow/review/coordinator-pushback.ts";
import { isCoordinatorPushbackCause } from "../../../olt/scripts/src/core/contracts/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import type { TransactionPort, WorkflowState } from "../../../olt/scripts/src/workflow/types.ts";

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
});
