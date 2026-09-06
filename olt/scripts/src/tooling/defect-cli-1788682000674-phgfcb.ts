export const DEFECT_ID = "defect-cli-1788682000674-phgfcb";
export const ERROR_CODE = "INVALID_ARGUMENT";
export const DEFECT_TITLE =
  "Defect Remediation: unknown command: report:unified; did you mean 'report:usage'?";

export interface UnifiedReportResolutionContext {
  readonly requestedCommand: string;
}

export interface UnifiedReportResolutionResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly resolved: boolean;
  readonly targetCommand: string;
  readonly suggestion: string;
  readonly error?: string;
}

export function resolveUnifiedReportCommand(
  context: UnifiedReportResolutionContext,
): UnifiedReportResolutionResult {
  const { requestedCommand } = context;

  if (requestedCommand === "report:unified") {
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      resolved: true,
      targetCommand: "report:usage",
      suggestion: "report:usage",
    };
  }

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    resolved: false,
    targetCommand: requestedCommand,
    suggestion: "report:usage",
    error: `unknown command: ${requestedCommand}; did you mean 'report:usage'?`,
  };
}
