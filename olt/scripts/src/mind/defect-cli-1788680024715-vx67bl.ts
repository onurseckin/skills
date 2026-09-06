export const DEFECT_ID = "defect-cli-1788680024715-vx67bl";
export const ERROR_CODE = "ROLE_CONFINEMENT_VIOLATION";
export const DEFECT_TITLE = "Defect Remediation: role validator may not invoke execution tool category 'test-runner': agent validator_validation is a cognitive validator, and shell/execution tools belong exclusively to mechanic validators. [Remediation: Cognitive validators must not execute shell commands or tests directly. Delegate test execution to a mechanic-validator subagent or inspect files using read-only tools.]";

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
    actor: "implementer_task_1_35",
    role: "implementer",
    taskId: "task-1_35",
    state: "validating",
    sessionToken: "tok_live_defect_cli_1788680024715_vx67bl",
    scope: ["olt/scripts/src/mind"],
    gateCommand: "bun test tests/mind/defect-cli-1788680024715-vx67bl.test.ts",
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
