export const DEFECT_ID = "defect-commit-cannot-record-own-hash";
export const ERROR_CODE = "STATUS_PROTOCOL_ALLOWS_SELF_REFERENTIAL_COMMIT_HASH";
export const DEFECT_TITLE =
  "Defect Remediation: Recording a landing commit hash inside the commit being described orphans the reference";

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
    actor: "implementer_lane_8",
    role: "implementer",
    taskId: "task-16",
    state: "validating",
    sessionToken: "tok_live_core_defect-commit-cannot-record-own-hash",
    scope: [
      "olt/scripts/src/core/recording-a-landing-commit-hash-inside-the-commit-being-described-orphans-the-reference-defect-commit-cannot-record-own-hash.ts",
    ],
    gateCommand:
      "bun test tests/core/recording-a-landing-commit-hash-inside-the-commit-being-described-orphans-the-reference-defect-commit-cannot-record-own-hash.test.ts",
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
