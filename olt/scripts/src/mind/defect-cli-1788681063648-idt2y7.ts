export const DEFECT_ID = "defect-cli-1788681063648-idt2y7";
export const ERROR_CODE = "CAPSULE_UNREADABLE";
export const DEFECT_MESSAGE =
  "plan:brainstorm could not load capsule state at --run cross-system-communication-system and is not on the grant bootstrap allowlist for missing capsules; an unreadable capsule cannot be treated as one with no grants";

export interface BrainstormCapsuleInspection {
  readonly runId: string;
  readonly isReadable: boolean;
  readonly onAllowlist: boolean;
  readonly capsulePath?: string | undefined;
  readonly rawError?: string | undefined;
}

export interface Defect1788681063648Idt2y7Result {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly allowed: boolean;
  readonly errors: readonly string[];
  readonly inspection: BrainstormCapsuleInspection;
}

export function formatBrainstormCapsuleError(
  runId: string = "cross-system-communication-system",
  onAllowlist: boolean = false,
): string {
  const resolvedRun = runId.length > 0 ? runId : "cross-system-communication-system";
  if (onAllowlist) {
    return `plan:brainstorm loaded uninitialized capsule state at --run ${resolvedRun} via grant bootstrap allowlist`;
  }
  return `plan:brainstorm could not load capsule state at --run ${resolvedRun} and is not on the grant bootstrap allowlist for missing capsules; an unreadable capsule cannot be treated as one with no grants`;
}

export function evaluateBrainstormCapsuleLoading(inspection: BrainstormCapsuleInspection): boolean {
  if (inspection.isReadable) {
    return true;
  }
  return inspection.onAllowlist;
}

export function auditBrainstormCapsuleState(
  partial?: Partial<BrainstormCapsuleInspection> | undefined,
): Defect1788681063648Idt2y7Result {
  const inspection: BrainstormCapsuleInspection = {
    runId:
      partial !== undefined && partial.runId !== undefined
        ? partial.runId
        : "cross-system-communication-system",
    isReadable:
      partial !== undefined && partial.isReadable !== undefined ? partial.isReadable : false,
    onAllowlist:
      partial !== undefined && partial.onAllowlist !== undefined ? partial.onAllowlist : false,
    capsulePath: partial !== undefined ? partial.capsulePath : undefined,
    rawError: partial !== undefined ? partial.rawError : undefined,
  };

  const allowed = evaluateBrainstormCapsuleLoading(inspection);
  const errors: string[] = [];

  if (!allowed) {
    errors.push(formatBrainstormCapsuleError(inspection.runId, inspection.onAllowlist));
  }

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    allowed,
    errors,
    inspection,
  };
}
