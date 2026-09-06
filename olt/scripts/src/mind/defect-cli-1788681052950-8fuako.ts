export const DEFECT_ID = "defect-cli-1788681052950-8fuako";
export const ERROR_CODE = "MANDATORY_PLAN_STEP_SKIPPED";
export const DEFECT_MESSAGE = "Cannot compile plan: plan:brainstorm must be executed first.";

export interface PlanCompilationPrerequisiteContext {
  readonly hasBrainstormed: boolean;
  readonly brainstormPath?: string | undefined;
  readonly planId?: string | undefined;
  readonly stagesExecuted?: readonly string[] | undefined;
}

export interface Defect17886810529508fuakoResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly allowed: boolean;
  readonly errors: readonly string[];
  readonly context: PlanCompilationPrerequisiteContext;
}

export function formatMandatoryPlanStepSkippedError(step: string = "plan:brainstorm"): string {
  const resolvedStep = step.length > 0 ? step : "plan:brainstorm";
  return `Cannot compile plan: ${resolvedStep} must be executed first.`;
}

export function evaluatePlanCompilationPrerequisites(
  context: PlanCompilationPrerequisiteContext,
): boolean {
  if (!context.hasBrainstormed) {
    return false;
  }
  if (context.stagesExecuted !== undefined) {
    return context.stagesExecuted.includes("plan:brainstorm");
  }
  return true;
}

export function auditPlanCompilationPrerequisites(
  partialContext?: Partial<PlanCompilationPrerequisiteContext>,
): Defect17886810529508fuakoResult {
  const resolvedContext: PlanCompilationPrerequisiteContext = {
    hasBrainstormed:
      partialContext !== undefined && partialContext.hasBrainstormed !== undefined
        ? partialContext.hasBrainstormed
        : false,
    brainstormPath: partialContext !== undefined ? partialContext.brainstormPath : undefined,
    planId: partialContext !== undefined ? partialContext.planId : undefined,
    stagesExecuted: partialContext !== undefined ? partialContext.stagesExecuted : undefined,
  };

  const allowed = evaluatePlanCompilationPrerequisites(resolvedContext);
  const errors: string[] = [];

  if (!allowed) {
    errors.push(formatMandatoryPlanStepSkippedError("plan:brainstorm"));
  }

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    allowed,
    errors,
    context: resolvedContext,
  };
}
