export const DEFECT_ID = "defect-cli-1788677155039-wwbq9t";
export const ERROR_CODE = "INTEGRITY";
export const DEFECT_TITLE =
  "Defect Remediation: post-attempt gate integrity failed: repository changed after gate attempt";

export interface DefectRemediationContext {
  readonly actor?: string;
  readonly role?: string;
  readonly taskId?: string;
  readonly state?: string;
  readonly sessionToken?: string;
  readonly scope?: readonly string[];
  readonly gateCommand?: string;
  readonly options?: readonly string[];
}

export interface DefectRemediationResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly allowed: boolean;
  readonly errors: readonly string[];
}

export function validateDefectPreconditions(context: DefectRemediationContext): boolean {
  if (context.options && context.options.includes("--disallowed-option")) {
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
  return true;
}

export function verifyDefectRemediation(
  context?: DefectRemediationContext,
): DefectRemediationResult {
  const ctx = context ?? {
    actor: "implementer_lane_1",
    role: "implementer",
    taskId: "task-9",
    state: "validating",
    sessionToken: "tok_live_core_defect-cli-1788677155039-wwbq9t",
    scope: ["olt/scripts/src/core/defect-cli-1788677155039-wwbq9t.ts"],
    gateCommand: "bun test tests/core/defect-cli-1788677155039-wwbq9t.test.ts",
    options: ["--compliant"],
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
