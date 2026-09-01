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
  validatorId: string = "val-1",
  domain: "code-quality" | "tests" = "code-quality",
): WorkflowState {
  return {
    tasks: {
      [taskId]: {
        id: taskId,
        status: "validated",
        requirement_ids: ["req-1"],
        write_scope: ["src/test.ts"],
        dependencies: [],
        attempts: [],
        history: [],
        repair_round: 0,
        original_implementer: "implementer-1",
        validations: [
          {
            validator_id: validatorId,
            domain,
            token_digest: "digest-1",
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

describe("Review Pushback Authority Validation and Criteria", () => {
  beforeEach(() => {
    setupVirtualTaskFS();
  });

  afterEach(() => {
    cleanupVirtualTaskFS();
  });
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
  beforeEach(() => {
    setupVirtualTaskFS();
  });

  afterEach(() => {
    cleanupVirtualTaskFS();
  });

  it("executes procedural pushback reopening validation without advancing repair round", () => {
    const initialState = createValidatedState("task-p1", "val-1");
    const port = createMockTransactionPort(initialState);

    const updatedState = recordCoordinatorPushback(port, "task-p1", "coordinator-1", {
      validator_id: "val-1",
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

    const updatedState = recordCoordinatorPushback(port, "task-p2", "coordinator-1", {
      validator_id: "val-1",
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

    const updatedState = recordCoordinatorPushback(
      port,
      "task-p3",
      "coordinator-1",
      {
        validator_id: "val-1",
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

  it("supports coordinator pushback with validated criteria", () => {
    const initialState = createValidatedState("task-p4", "val-1");
    const port = createMockTransactionPort(initialState);

    const input = {
      validator_id: "val-1",
      domain: "code-quality" as const,
      cause: "procedural" as const,
      observation: "Contesting standing pass due to lack of discriminating proof",
      remediation: "Provide falsifiable proof",
      guidance: ["Check negative cases"],
      rejection_reasons: ["unsubstantiated_claims"],
    };

    validateReviewPushbackCriteria("task-p4", "coordinator-1", input);

    const updatedState = recordCoordinatorPushback(port, "task-p4", "coordinator-1", input);

    expect(updatedState.tasks["task-p4"]!.status).toBe("validating");
    expect(isCoordinatorPushbackCause("procedural")).toBe(true);
    expect(isCoordinatorPushbackCause("substantive")).toBe(true);
    expect(() =>
      validateCoordinatorPushbackInput({
        validator_id: "val-1",
        domain: "code-quality",
        cause: "procedural",
        observation: "Valid observation",
        remediation: "Valid remediation",
      }),
    ).not.toThrow();
  });
});
