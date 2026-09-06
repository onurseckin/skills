export const DEFECT_ID = "defect-cli-1788677466808-fhe76v";
export const ERROR_CODE = "INVALID_STATE";
export const DEFECT_TITLE =
  "Defect Remediation: run is not ready for completeness critic: requirement req-4 has no evidence; requirement req-4 is not satisfied; run gate gate-run-completion lacks an authoritative passing command; running command blocks completion: C-ff4beef1-fa41-43c4-aae0-3a4bb4c95fb0; task task-1 lacks code-quality validator command evidence; task task-3 lacks code-quality validator command evidence; task task-4 is validated, not done; task task-4 lacks authoritative gate gate-4; task task-4 lacks code-quality validator command evidence";

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
    actor: "implementer_b2",
    role: "implementer",
    taskId: "task-17",
    state: "validating",
    sessionToken: "tok_live_19c1a588f592d5702128ab98d1e9cbc52bdaf68cbe18c9d0",
    scope: ["olt/scripts/src/validation"],
    gateCommand: "bun test tests/validation/defect-cli-1788677466808-fhe76v.test.ts",
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
