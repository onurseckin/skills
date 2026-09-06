export const DEFECT_ID = "defect-cli-1788680173232-dgvusi";
export const ERROR_CODE = "INVALID_ARGUMENT";
export const DEFECT_TITLE = "Defect Remediation: unknown command: sync";

export interface SyncCommandResolutionContext {
  readonly requestedCommand: string;
  readonly defaultTarget?: string;
}

export interface SyncCommandResolutionResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly resolved: boolean;
  readonly canonicalCommand: string;
  readonly error?: string;
}

export function resolveSyncCommand(
  context: SyncCommandResolutionContext,
): SyncCommandResolutionResult {
  const { requestedCommand, defaultTarget = "queue:wave" } = context;

  if (requestedCommand === "sync") {
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      resolved: true,
      canonicalCommand: defaultTarget,
    };
  }

  if (requestedCommand === "queue:wave") {
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      resolved: true,
      canonicalCommand: requestedCommand,
    };
  }

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    resolved: false,
    canonicalCommand: requestedCommand,
    error: `unknown command: ${requestedCommand}`,
  };
}
