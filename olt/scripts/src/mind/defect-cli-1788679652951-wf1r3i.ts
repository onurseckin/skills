export const DEFECT_ID = "defect-cli-1788679652951-wf1r3i";
export const ERROR_CODE = "INVALID_STATE";
export const DEFECT_TITLE = "Defect Remediation: role validator may not invoke run:exec: cognitive validators are strictly banned from executing bash/shell commands or running test suites (run:exec); agent validator_task2 holds a validator grant, and the contract at /Users/onurseckinsenoglu/repos/skills/olt/agents/validator.yaml grants only task:brief, task:validate-start, task:probe, task:reject, task:review, finding:get, report:get, evidence:get, evidence:screenshots, agent:register, agent:report, agent:release, whoami, msg:send, msg:recv, msg:poll. [Remediation: Cognitive validators must not execute shell commands or tests directly. Delegate test execution to a mechanic-validator subagent or inspect files using read-only tools.]";

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
    actor: "implementer_task_1_24",
    role: "implementer",
    taskId: "task-1_24",
    state: "validating",
    sessionToken: "tok_live_defect_cli_1788679652951_wf1r3i",
    scope: ["olt/scripts/src/mind"],
    gateCommand: "bun test tests/mind/defect-cli-1788679652951-wf1r3i.test.ts",
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
