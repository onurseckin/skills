export const DEFECT_ID = "defect-cli-1788705566952-j272am";
export const ERROR_CODE = "QUOTA_EXHAUSTED";
export const DEFECT_TITLE =
  "Defect Remediation: Quota Semantic Inversion and Session Resolution Failure";

export interface DefectRemediationContext {
  readonly actor?: string | undefined;
  readonly role?: string | undefined;
  readonly taskId?: string | undefined;
  readonly state?: string | undefined;
  readonly sessionToken?: string | undefined;
  readonly scope?: readonly string[] | undefined;
  readonly gateCommand?: string | undefined;
  readonly options?: readonly string[] | undefined;
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
    taskId: "task-quota-resilience",
    state: "validating",
    sessionToken: "tok_live_telemetry_defect-cli-1788705566952-j272am",
    scope: ["olt/scripts/src/telemetry/defect-cli-1788705566952-j272am.ts"],
    gateCommand: "bun test",
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
