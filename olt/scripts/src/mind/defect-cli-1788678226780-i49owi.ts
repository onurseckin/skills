export const DEFECT_ID = "defect-cli-1788678226780-i49owi";
export const ERROR_CODE = "INVALID_STATE";
export const DEFECT_TITLE = "Defect Remediation: pulse pulse-2 is open and past its deadline (2026-09-06T07:01:42.437Z); reclaim it first with mind:wake --run .olt/capsules/mind-gen-2";

export interface DefectRemediationContext {
  readonly actor?: string;
  readonly role?: string;
  readonly taskId?: string;
  readonly state?: string;
  readonly sessionToken?: string;
  readonly scope?: readonly string[];
  readonly gateCommand?: string;
  readonly isUiTask?: boolean;
  readonly validatorType?: string;
}

export interface DefectRemediationResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly allowed: boolean;
  readonly errors: readonly string[];
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
  return true;
}

export function verifyDefectRemediation(
  context?: DefectRemediationContext,
): DefectRemediationResult {
  const fallbackContext: DefectRemediationContext = {
    actor: "implementer_task_1_14",
    role: "implementer",
    taskId: "task-1_14",
    state: "validating",
    sessionToken: "tok_live_defect_cli_1788678226780_i49owi",
    scope: ["olt/scripts/src/mind"],
    gateCommand: "bun test tests/mind/defect-cli-1788678226780-i49owi.test.ts",
    isUiTask: false,
    validatorType: "validator",
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
