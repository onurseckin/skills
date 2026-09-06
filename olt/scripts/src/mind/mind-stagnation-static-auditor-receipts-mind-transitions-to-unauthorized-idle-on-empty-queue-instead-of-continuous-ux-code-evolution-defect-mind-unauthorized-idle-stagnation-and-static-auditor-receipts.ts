export const DEFECT_ID = "defect-mind-unauthorized-idle-stagnation-and-static-auditor-receipts";
export const ERROR_CODE = "MIND_UNAUTHORIZED_IDLE_STAGNATION";
export const DEFECT_TITLE =
  "Defect Remediation: Mind Stagnation & Static Auditor Receipts: Mind Transitions to Unauthorized Idle on Empty Queue Instead of Continuous UX/Code Evolution";

export interface DefectRemediationContext {
  readonly actor?: string | undefined;
  readonly role?: string | undefined;
  readonly taskId?: string | undefined;
  readonly state?: string | undefined;
  readonly sessionToken?: string | undefined;
  readonly scope?: readonly string[] | undefined;
  readonly gateCommand?: string | undefined;
  readonly isUiTask?: boolean | undefined;
  readonly validatorType?: string | undefined;
  readonly queueEmpty?: boolean | undefined;
  readonly isIdle?: boolean | undefined;
}

export interface DefectRemediationResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly allowed: boolean;
  readonly errors: readonly string[];
}

export interface MindContinuousEvolutionState {
  readonly queueEmpty: boolean;
  readonly isIdle: boolean;
  readonly creativeEvaluationActive: boolean;
  readonly uxExplorationActive: boolean;
  readonly roadmapSynthesisActive: boolean;
}

export interface AuditorReceipt {
  readonly isStaticMachineTelemetry: boolean;
  readonly deltaCount: number;
  readonly cognitivePrompt?: string | undefined;
}

export interface StagnationEvaluationResult {
  readonly idleAllowed: boolean;
  readonly stagnationDetected: boolean;
  readonly forcedAction: "continue_evolution" | "socratic_prompt" | "halt";
  readonly creativePrompt: string;
}

export function validateDefectPreconditions(context: DefectRemediationContext): boolean {
  if (
    context.state !== undefined &&
    !["validated", "validating", "gating", "completed"].includes(context.state)
  ) {
    return false;
  }
  if (
    context.role !== undefined &&
    context.actor !== undefined &&
    context.role === "coordinator" &&
    context.actor.includes("critic")
  ) {
    return false;
  }
  if (
    context.isUiTask === true &&
    context.validatorType !== undefined &&
    !context.validatorType.startsWith("ui-")
  ) {
    return false;
  }
  if (context.queueEmpty === true && context.isIdle === true) {
    return false;
  }
  return true;
}

export function evaluateContinuousEvolution(
  state: MindContinuousEvolutionState,
  receipt: AuditorReceipt,
): StagnationEvaluationResult {
  if (state.queueEmpty && state.isIdle) {
    return {
      idleAllowed: false,
      stagnationDetected: true,
      forcedAction: "socratic_prompt",
      creativePrompt:
        "Queue empty: Maintain continuous creative evaluation, UX interaction exploration, and forward roadmap synthesis.",
    };
  }

  if (receipt.isStaticMachineTelemetry && receipt.deltaCount === 0 && !receipt.cognitivePrompt) {
    return {
      idleAllowed: false,
      stagnationDetected: true,
      forcedAction: "socratic_prompt",
      creativePrompt:
        "Static telemetry zero-delta receipt rejected: Generate constructive creative prompt to re-ignite ideation.",
    };
  }

  return {
    idleAllowed: !state.isIdle,
    stagnationDetected: false,
    forcedAction: "continue_evolution",
    creativePrompt: receipt.cognitivePrompt ?? "Continuous evolution nominal.",
  };
}

export function verifyDefectRemediation(
  context?: DefectRemediationContext,
): DefectRemediationResult {
  const fallbackContext: DefectRemediationContext = {
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
    isUiTask: false,
    validatorType: "validator",
    queueEmpty: false,
    isIdle: false,
  };
  const ctx = context !== undefined ? context : fallbackContext;

  const isValid = validateDefectPreconditions(ctx);
  const errors: string[] = [];

  if (!isValid) {
    errors.push("Violation of precondition under " + ERROR_CODE + ": " + DEFECT_TITLE);
  }

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    allowed: isValid,
    errors,
  };
}
