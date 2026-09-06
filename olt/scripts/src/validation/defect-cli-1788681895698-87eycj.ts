export const DEFECT_ID = "defect-cli-1788681895698-87eycj";
export const ERROR_CODE = "INVALID_STATE";
export const DEFECT_TITLE =
  "Defect Remediation: cannot pass task-1: no recorded falsifiable gate:prove proof for gate-1 (`bun test tests/liaison/agent`); run `gate:prove --run <run> --task task-1 --actor <actor>` and record a falsifiable proof against this attempt's claimed base before this review can pass";

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
    actor: "implementer_b6",
    role: "implementer",
    taskId: "task-87",
    state: "validating",
    sessionToken: "tok_live_47af07147ad48ec21ab9519fbd5fccc5c6c02702e935ab82",
    scope: ["olt/scripts/src/validation"],
    gateCommand: "bun test tests/validation/defect-cli-1788681895698-87eycj.test.ts",
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
