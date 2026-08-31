import { describe, expect, it } from "bun:test";
import {
  assertPushbackSafety,
  contestValidatorVerdict,
  evaluatePushbackReport,
  executeCoordinatorPushback,
  isProceduralPushback,
  isSubstantivePushback,
  validatePushbackEvidence,
  auditTaskVerificationEvidence,
  appendPushbackRound,
  createPushbackHistory,
  detectDomainBatching,
  evaluateCounterfactualEvidence,
  evaluateRepairProgression,
  generateCorrectiveGuidance,
  isRepairExhausted,
  rejectSuperficialClaims,
  validateReviewPushbackCriteria,
  validateReviewPushbackInput,
  type PushbackContestOptions,
} from "../../../olt/scripts/src/task/pushback.ts";
import { createSamplePushbackInput, TASK_PUSHBACK_SUITES } from "./index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import type {
  CoordinatorPushbackCause,
  ValidatorDomain,
} from "../../../olt/scripts/src/core/contracts/index.ts";
import type { TransactionPort, WorkflowState } from "../../../olt/scripts/src/workflow/types.ts";

function createMockPort(initial: WorkflowState): TransactionPort {
  let state = structuredClone(initial);
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
  domain: ValidatorDomain = "code-quality",
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
        original_implementer: "impl-1",
        validations: [
          {
            validator_id: validatorId,
            domain,
            token_digest: "digest-1",
            attempt: 1,
            started_at: "2026-08-29T10:00:00.000Z",
            deadline_at: "2026-08-29T11:00:00.000Z",
            verdict: "pass",
          },
        ],
      },
    },
  };
}

describe("task pushback path unit tests", () => {
  it("recognizes pushback cause categories", () => {
    expect(isProceduralPushback("procedural")).toBe(true);
    expect(isProceduralPushback("substantive")).toBe(false);
    expect(isProceduralPushback("invalid")).toBe(false);
    expect(isSubstantivePushback("substantive")).toBe(true);
    expect(isSubstantivePushback("procedural")).toBe(false);
    expect(isSubstantivePushback(undefined)).toBe(false);
  });

  it("validates pushback evidence invariants", () => {
    expect(() =>
      validatePushbackEvidence("procedural", "Valid observation", "Valid remediation"),
    ).not.toThrow();

    expect(() =>
      validatePushbackEvidence("substantive", "Valid observation", "Valid remediation"),
    ).not.toThrow();

    expect(() =>
      validatePushbackEvidence(
        "invalid_cause" as unknown as CoordinatorPushbackCause,
        "Valid observation",
        "Valid remediation",
      ),
    ).toThrow(HarnessError);

    expect(() => validatePushbackEvidence("procedural", "", "Valid remediation")).toThrow(
      HarnessError,
    );

    expect(() => validatePushbackEvidence("substantive", "Valid observation", "   ")).toThrow(
      HarnessError,
    );
  });

  it("executes coordinator pushback for procedural cause", () => {
    const state = createValidatedState("task-alpha", "val-1", "code-quality");
    const port = createMockPort(state);

    const updated = executeCoordinatorPushback(port, "task-alpha", "coordinator-1", {
      validatorId: "val-1",
      domain: "code-quality",
      cause: "procedural",
      observation: "Missing test evidence logs",
      remediation: "Re-run suite with logging enabled",
    });

    const task = updated.tasks["task-alpha"];
    expect(task).toBeDefined();
    expect(task?.status).toBe("validating");
    expect(task?.repair_round).toBe(0);
    expect(task?.coordinator_pushbacks).toHaveLength(1);
    expect(task?.coordinator_pushbacks?.[0]?.cause).toBe("procedural");
  });

  it("executes coordinator pushback for substantive cause with escalation on exhaustion", () => {
    const state = createValidatedState("task-beta", "val-2", "security");
    const port = createMockPort(state);

    const updated = executeCoordinatorPushback(
      port,
      "task-beta",
      "coordinator-1",
      {
        validatorId: "val-2",
        domain: "security",
        cause: "substantive",
        observation: "Vulnerability in SQL escaping",
        remediation: "Use parameterized queries",
      },
      undefined,
      1,
    );

    const task = updated.tasks["task-beta"];
    expect(task).toBeDefined();
    expect(task?.status).toBe("escalated");
    expect(task?.repair_round).toBe(1);
    expect(task?.repair_assignee).toBe("impl-1");
  });

  it("contests validator verdict using contestValidatorVerdict helper", () => {
    const state = createValidatedState("task-gamma", "val-3", "system-design");
    const port = createMockPort(state);

    const options: PushbackContestOptions = {
      taskId: "task-gamma",
      coordinatorId: "coordinator-1",
      validatorId: "val-3",
      domain: "system-design",
      cause: "procedural",
      observation: "Architecture diagram omitted",
      remediation: "Attach component diagram",
      guidance: ["Provide PNG or mermaid diagram"],
      rejectionReasons: ["missing_diagram"],
    };

    const updated = contestValidatorVerdict(port, options);
    const task = updated.tasks["task-gamma"];
    expect(task?.status).toBe("validating");
    expect(task?.coordinator_pushbacks).toHaveLength(1);

    expect(() =>
      contestValidatorVerdict(port, {
        ...options,
        domain: "invalid-domain" as unknown as ValidatorDomain,
      }),
    ).toThrow(HarnessError);

    const sampleInput = createSamplePushbackInput();
    expect(sampleInput.taskId).toBe("task-pushback-sample");
    expect(TASK_PUSHBACK_SUITES.length).toBe(5);
  });
});
