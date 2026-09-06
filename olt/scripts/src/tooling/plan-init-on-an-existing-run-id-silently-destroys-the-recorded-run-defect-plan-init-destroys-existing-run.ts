export const DEFECT_ID = "defect-plan-init-destroys-existing-run";
export const ERROR_CODE = "PLAN_INIT_DESTROYS_EXISTING_RUN_CAPSULE";
export const DEFECT_TITLE =
  "Defect Remediation: plan:init on an existing run id silently destroys the recorded run";

export interface CapsuleCheckContext {
  readonly capsulePath: string;
  readonly runId: string;
  readonly force?: boolean;
  readonly actor?: string;
}

export interface CapsuleCheckResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly allowed: boolean;
  readonly exists: boolean;
  readonly reason?: string;
}

export interface ExistingCapsuleRecord {
  readonly runId: string;
  readonly capsulePath: string;
  readonly hasEvents: boolean;
  readonly hasReports: boolean;
  readonly isCompleted: boolean;
}

export function evaluateCapsuleOverwriteGuard(
  capsule: ExistingCapsuleRecord | undefined,
  force = false,
): { readonly allowed: boolean; readonly reason?: string } {
  if (!capsule) {
    return { allowed: true };
  }

  if (force) {
    return { allowed: true };
  }

  if (capsule.isCompleted) {
    return {
      allowed: false,
      reason: `Cannot re-initialize completed capsule for run '${capsule.runId}'. The capsule contains final evidence and must not be erased without explicit confirmation.`,
    };
  }

  if (capsule.hasEvents || capsule.hasReports) {
    return {
      allowed: false,
      reason: `Capsule for run '${capsule.runId}' already exists and contains durable records. Re-initialization refused to prevent destructive data loss.`,
    };
  }

  return { allowed: true };
}

export function inspectAndGuardPlanInit(
  context: CapsuleCheckContext,
  existingRecord?: ExistingCapsuleRecord,
): CapsuleCheckResult {
  const { runId, force = false } = context;
  const guard = evaluateCapsuleOverwriteGuard(existingRecord, force);

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    allowed: guard.allowed,
    exists: existingRecord !== undefined,
    ...(guard.reason !== undefined ? { reason: guard.reason } : {}),
  };
}
