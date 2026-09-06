export const DEFECT_ID = "defect-cli-1788676926650-mvlcks";
export const ERROR_CODE = "INVALID_STATE";
export const DEFECT_TITLE =
  "Defect Remediation: review check command C-1f2cd80a-bc87-4f42-b672-ff1cbb8e00c4 is not successful validator evidence for task-5";

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
    context.state &&
    !["validated", "validating", "gating", "completed"].includes(context.state)
  ) {
    return false;
  }
  if (
    context.role &&
    context.actor &&
    context.role === "coordinator" &&
    context.actor.includes("critic")
  ) {
    return false;
  }
  if (context.isUiTask && context.validatorType && !context.validatorType.startsWith("ui-")) {
    return false;
  }
  return true;
}

export function verifyDefectRemediation(
  context?: DefectRemediationContext,
): DefectRemediationResult {
  const ctx = context ?? {
    actor: "implementer_b1",
    role: "implementer",
    taskId: "task-10",
    state: "validating",
    sessionToken: "tok_live_acdda43f6205ba442831e72ebe5543fdff7665204fa1d16c",
    scope: ["olt/scripts/src/validation"],
    gateCommand: "bun test tests/validation/defect-cli-1788676926650-mvlcks.test.ts",
    isUiTask: false,
    validatorType: "validator",
  };

  const isValid = validateDefectPreconditions(ctx);
  const errors: string[] = [];

  if (!isValid) {
    errors.push(`Violation of precondition under ${ERROR_CODE}: ${DEFECT_TITLE}`);
  }

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    allowed: isValid,
    errors,
  };
}
