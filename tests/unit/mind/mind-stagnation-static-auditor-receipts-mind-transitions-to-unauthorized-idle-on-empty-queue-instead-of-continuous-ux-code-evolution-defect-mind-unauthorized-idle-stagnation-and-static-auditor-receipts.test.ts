import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  validateDefectPreconditions,
  verifyDefectRemediation,
  evaluateContinuousEvolution,
  type DefectRemediationContext,
  type DefectRemediationResult,
  type MindContinuousEvolutionState,
  type AuditorReceipt,
} from "../../../olt/scripts/src/mind/mind-stagnation-static-auditor-receipts-mind-transitions-to-unauthorized-idle-on-empty-queue-instead-of-continuous-ux-code-evolution-defect-mind-unauthorized-idle-stagnation-and-static-auditor-receipts.ts";

describe("Defect Remediation: MIND_UNAUTHORIZED_IDLE_STAGNATION", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-mind-unauthorized-idle-stagnation-and-static-auditor-receipts");
    expect(ERROR_CODE).toBe("MIND_UNAUTHORIZED_IDLE_STAGNATION");
    expect(DEFECT_TITLE).toContain("Mind Stagnation & Static Auditor Receipts");
  });

  test("validates compliant execution context cleanly", () => {
    const validCtx: DefectRemediationContext = {
      actor: "implementer_task_1_1",
      role: "implementer",
      taskId: "task-1_1",
      state: "validating",
      sessionToken: "tok_live_DEFECT_MIND_UNAUTHORIZED_IDLE_STAGNATION",
      scope: [
        "olt/scripts/src/mind/mind-stagnation-static-auditor-receipts-mind-transitions-to-unauthorized-idle-on-empty-queue-instead-of-continuous-ux-code-evolution-defect-mind-unauthorized-idle-stagnation-and-static-auditor-receipts.ts",
      ],
      gateCommand:
        "bun test tests/unit/mind/mind-stagnation-static-auditor-receipts-mind-transitions-to-unauthorized-idle-on-empty-queue-instead-of-continuous-ux-code-evolution-defect-mind-unauthorized-idle-stagnation-and-static-auditor-receipts.test.ts",
      queueEmpty: false,
      isIdle: false,
    };
    expect(validateDefectPreconditions(validCtx)).toBe(true);
    const result: DefectRemediationResult = verifyDefectRemediation(validCtx);
    expect(result.remediated).toBe(true);
    expect(result.allowed).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  test("rejects unauthorized idle state upon empty queue", () => {
    const idleCtx: DefectRemediationContext = {
      queueEmpty: true,
      isIdle: true,
    };
    expect(validateDefectPreconditions(idleCtx)).toBe(false);
    const result: DefectRemediationResult = verifyDefectRemediation(idleCtx);
    expect(result.remediated).toBe(true);
    expect(result.allowed).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("enforces creative prompt generation on idle and empty queue", () => {
    const stagnantState: MindContinuousEvolutionState = {
      queueEmpty: true,
      isIdle: true,
      creativeEvaluationActive: false,
      uxExplorationActive: false,
      roadmapSynthesisActive: false,
    };
    const receipt: AuditorReceipt = {
      isStaticMachineTelemetry: false,
      deltaCount: 0,
    };
    const res = evaluateContinuousEvolution(stagnantState, receipt);
    expect(res.idleAllowed).toBe(false);
    expect(res.stagnationDetected).toBe(true);
    expect(res.forcedAction).toBe("socratic_prompt");
    expect(res.creativePrompt).toContain("Queue empty");
  });

  test("rejects static zero-delta machine telemetry receipt without cognitive prompt", () => {
    const nominalState: MindContinuousEvolutionState = {
      queueEmpty: false,
      isIdle: false,
      creativeEvaluationActive: true,
      uxExplorationActive: true,
      roadmapSynthesisActive: true,
    };
    const staticReceipt: AuditorReceipt = {
      isStaticMachineTelemetry: true,
      deltaCount: 0,
    };
    const res = evaluateContinuousEvolution(nominalState, staticReceipt);
    expect(res.idleAllowed).toBe(false);
    expect(res.stagnationDetected).toBe(true);
    expect(res.forcedAction).toBe("socratic_prompt");
    expect(res.creativePrompt).toContain("Static telemetry zero-delta receipt rejected");
  });

  test("allows active cognitive receipt during continuous evolution", () => {
    const nominalState: MindContinuousEvolutionState = {
      queueEmpty: false,
      isIdle: false,
      creativeEvaluationActive: true,
      uxExplorationActive: true,
      roadmapSynthesisActive: true,
    };
    const cognitiveReceipt: AuditorReceipt = {
      isStaticMachineTelemetry: false,
      deltaCount: 3,
      cognitivePrompt: "Explore dark mode accessibility across onboarding flow.",
    };
    const res = evaluateContinuousEvolution(nominalState, cognitiveReceipt);
    expect(res.idleAllowed).toBe(true);
    expect(res.stagnationDetected).toBe(false);
    expect(res.forcedAction).toBe("continue_evolution");
    expect(res.creativePrompt).toBe("Explore dark mode accessibility across onboarding flow.");
  });
});
