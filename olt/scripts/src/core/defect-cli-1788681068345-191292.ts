export const DEFECT_ID = "defect-cli-1788681068345-191292";
export const ERROR_CODE = "INTEGRITY";
export const DEFECT_TITLE =
  "Defect Remediation: tasks task-2, task-3, task-4 have no prompt line to bind to and cannot be folded into another requirement; pass --requirement-lines to bind each one to the lines it actually implements";

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
    actor: "implementer_lane_4",
    role: "implementer",
    taskId: "task-132",
    state: "validating",
    sessionToken: "tok_live_core_defect-cli-1788681068345-191292",
    scope: ["olt/scripts/src/core/defect-cli-1788681068345-191292.ts"],
    gateCommand: "bun test tests/core/defect-cli-1788681068345-191292.test.ts",
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
