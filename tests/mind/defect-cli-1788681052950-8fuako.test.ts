import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_MESSAGE,
  formatMandatoryPlanStepSkippedError,
  evaluatePlanCompilationPrerequisites,
  auditPlanCompilationPrerequisites,
  type PlanCompilationPrerequisiteContext,
  type Defect17886810529508fuakoResult,
} from "../../olt/scripts/src/mind/defect-cli-1788681052950-8fuako.ts";

describe("Defect Remediation: defect-cli-1788681052950-8fuako", () => {
  test("exports constants with expected values", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788681052950-8fuako");
    expect(ERROR_CODE).toBe("MANDATORY_PLAN_STEP_SKIPPED");
    expect(DEFECT_MESSAGE).toBe("Cannot compile plan: plan:brainstorm must be executed first.");
  });

  test("formats skipped step error correctly", () => {
    const defaultErr = formatMandatoryPlanStepSkippedError();
    expect(defaultErr).toBe("Cannot compile plan: plan:brainstorm must be executed first.");

    const customStep = formatMandatoryPlanStepSkippedError("plan:audit");
    expect(customStep).toBe("Cannot compile plan: plan:audit must be executed first.");
  });

  test("evaluates compilation prerequisites properly", () => {
    const unbrainstormed: PlanCompilationPrerequisiteContext = {
      hasBrainstormed: false,
    };
    expect(evaluatePlanCompilationPrerequisites(unbrainstormed)).toBe(false);

    const brainstormedValid: PlanCompilationPrerequisiteContext = {
      hasBrainstormed: true,
      stagesExecuted: ["plan:init", "plan:brainstorm"],
    };
    expect(evaluatePlanCompilationPrerequisites(brainstormedValid)).toBe(true);

    const brainstormedMissingStage: PlanCompilationPrerequisiteContext = {
      hasBrainstormed: true,
      stagesExecuted: ["plan:init"],
    };
    expect(evaluatePlanCompilationPrerequisites(brainstormedMissingStage)).toBe(false);
  });

  test("auditPlanCompilationPrerequisites detects default unbrainstormed condition", () => {
    const result: Defect17886810529508fuakoResult = auditPlanCompilationPrerequisites();
    expect(result.remediated).toBe(true);
    expect(result.allowed).toBe(false);
    expect(result.defectId).toBe(DEFECT_ID);
    expect(result.errorCode).toBe(ERROR_CODE);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toBe(DEFECT_MESSAGE);
  });

  test("auditPlanCompilationPrerequisites passes when brainstormed", () => {
    const result = auditPlanCompilationPrerequisites({
      hasBrainstormed: true,
      brainstormPath: ".olt/capsules/cluster-mind-187ac3a5/brainstorming.json",
      stagesExecuted: ["plan:brainstorm"],
    });
    expect(result.remediated).toBe(true);
    expect(result.allowed).toBe(true);
    expect(result.errors.length).toBe(0);
  });
});
