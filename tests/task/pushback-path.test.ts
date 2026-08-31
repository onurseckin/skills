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
} from "../../olt/scripts/src/task/pushback.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import type {
  CoordinatorPushbackCause,
  ValidatorDomain,
} from "../../olt/scripts/src/core/contracts/index.ts";
import type { TransactionPort, WorkflowState } from "../../olt/scripts/src/workflow/types.ts";

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
  });

  it("evaluates pushback safety and unfulfilled demand reports", () => {
    const dummyState = { workflow: { state: "nominal" } };
    const report = evaluatePushbackReport(dummyState);
    expect(report).toBeDefined();
    expect(report.hasUnfulfilledDemands).toBe(false);
    expect(() => assertPushbackSafety(dummyState)).not.toThrow();
  });

  it("re-exports authority review tools and evaluators correctly", () => {
    let history = createPushbackHistory("task-reexport", 3);
    expect(history.currentRound).toBe(0);

    history = appendPushbackRound(history, {
      coordinatorId: "coord-1",
      validatorId: "val-1",
      domain: "code-quality",
      cause: "substantive",
      observation: "Bug in math",
      remediation: "Fix calculation",
      rejectionReasons: ["bad_math"],
    });
    expect(history.currentRound).toBe(1);

    expect(isRepairExhausted(3, 3)).toBe(true);
    expect(isRepairExhausted(1, 3)).toBe(false);

    const superficial = rejectSuperficialClaims("LGTM");
    expect(superficial.isSuperficial).toBe(true);

    const batching = detectDomainBatching(["code-quality"], { "code-quality": { log: "pass" } });
    expect(batching.isBatched).toBe(false);

    const counterfactual = evaluateCounterfactualEvidence([]);
    expect(counterfactual.isSufficient).toBe(false);

    const guidance = generateCorrectiveGuidance(history);
    expect(guidance.length).toBeGreaterThan(0);

    const validatedInput = validateReviewPushbackInput({
      validator_id: "val-1",
      domain: "code-quality",
      cause: "procedural",
      observation: "Needs test output",
      remediation: "Add logs",
    });
    expect(validatedInput.validatorId).toBe("val-1");

    expect(() =>
      validateReviewPushbackCriteria("task-1", "coord-1", {
        validator_id: "val-1",
        domain: "code-quality",
        cause: "procedural",
        observation: "Obs",
        remediation: "Rem",
      }),
    ).not.toThrow();

    const audit = auditTaskVerificationEvidence({
      taskId: "task-1",
      summary: "looks good",
      checks: [],
      evidence: [],
    });
    expect(audit.valid).toBe(false);

    const progression = evaluateRepairProgression(history, {
      taskId: "task-reexport",
      summary: "Fix calculation",
      checks: [{ command: "bun test", exit_code: 0 }],
    });
    expect(progression).toBeDefined();
  });

  it("handles validator_id snake_case and missing validatorId in executeCoordinatorPushback", () => {
    const state = createValidatedState("task-snake", "val-snake", "code-quality");
    const port = createMockPort(state);

    const updated = executeCoordinatorPushback(port, "task-snake", "coordinator-1", {
      validator_id: "val-snake",
      domain: "code-quality",
      cause: "procedural",
      observation: "Missing test evidence logs",
      remediation: "Re-run suite with logging enabled",
    });
    expect(updated.tasks["task-snake"]?.status).toBe("validating");

    const state2 = createValidatedState("task-empty-val", "val-empty", "code-quality");
    const port2 = createMockPort(state2);
    expect(() =>
      executeCoordinatorPushback(port2, "task-empty-val", "coordinator-1", {
        domain: "code-quality",
        cause: "procedural",
        observation: "Missing test evidence logs",
        remediation: "Re-run suite with logging enabled",
      } as unknown as {
        cause: CoordinatorPushbackCause;
        domain: ValidatorDomain;
        observation: string;
        remediation: string;
      }),
    ).toThrow(HarnessError);
  });

  it("verifies task/index.ts exports and guards", async () => {
    const taskIndex = await import("../../../olt/scripts/src/task/index.ts");
    expect(taskIndex.isCoordinatorPushbackCause("procedural")).toBe(true);
    expect(taskIndex.isCoordinatorPushbackCause("substantive")).toBe(true);
    expect(taskIndex.isCoordinatorPushbackCause("other")).toBe(false);
    expect(taskIndex.isValidatorDomain("code-quality")).toBe(true);
    expect(taskIndex.isValidatorDomain("security")).toBe(true);
    expect(taskIndex.isValidatorDomain("unknown")).toBe(false);
    expect(typeof taskIndex.executeCoordinatorPushback).toBe("function");
    expect(typeof taskIndex.contestValidatorVerdict).toBe("function");
    expect(typeof taskIndex.evaluatePushbackReport).toBe("function");
    expect(typeof taskIndex.assertPushbackSafety).toBe("function");
  });
});
