export const DEFECT_ID = "defect-cli-1788682343435-2mhud4";
export const ERROR_CODE = "INVALID_ARGUMENT";
export const DEFECT_TITLE = "Defect Remediation: unknown command: msg:read";

export interface MsgReadResolutionContext {
  readonly requestedCommand: string;
}

export interface MsgReadResolutionResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly resolved: boolean;
  readonly canonicalCommand: string;
  readonly error?: string;
}

export function resolveMsgReadCommand(
  context: MsgReadResolutionContext,
): MsgReadResolutionResult {
  const { requestedCommand } = context;

  if (requestedCommand === "msg:read") {
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      resolved: true,
      canonicalCommand: "msg:recv",
    };
  }

  if (requestedCommand === "msg:recv") {
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      resolved: true,
      canonicalCommand: "msg:recv",
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
