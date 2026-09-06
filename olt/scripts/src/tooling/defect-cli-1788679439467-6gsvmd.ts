export const DEFECT_ID = "defect-cli-1788679439467-6gsvmd";
export const ERROR_CODE = "INVALID_ARGUMENT";
export const DEFECT_TITLE = "Defect Remediation: unknown command: task:recover";

export interface TaskRecoveryCommandContext {
  readonly requestedCommand: string;
  readonly taskId?: string;
  readonly leaseOwner?: string;
}

export interface TaskRecoveryCommandResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly resolved: boolean;
  readonly canonicalCommand?: string;
  readonly action?: string;
  readonly error?: string;
}

export function resolveTaskRecoverCommand(
  context: TaskRecoveryCommandContext,
): TaskRecoveryCommandResult {
  const { requestedCommand } = context;

  if (requestedCommand === "task:recover") {
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      resolved: true,
      canonicalCommand: "task:release",
      action: "release_orphaned_lease",
    };
  }

  if (requestedCommand === "task:release" || requestedCommand === "task:claim") {
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      resolved: true,
      canonicalCommand: requestedCommand,
      action: "standard_lease_lifecycle",
    };
  }

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    resolved: false,
    error: `unknown command: ${requestedCommand}`,
  };
}
