export const DEFECT_ID = "defect-cli-1788678566314-si9rnh";
export const ERROR_CODE = "INVALID_ARGUMENT";
export const DEFECT_TITLE =
  "Defect Remediation: unknown command: report:unified; did you mean 'report:usage'?";

export interface ReportCommandResolutionContext {
  readonly requestedCommand: string;
  readonly supportedCommands?: readonly string[];
}

export interface ReportCommandResolutionResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly resolved: boolean;
  readonly canonicalCommand?: string;
  readonly suggestion?: string;
  readonly error?: string;
}

export function resolveReportUnifiedCommand(
  context: ReportCommandResolutionContext,
): ReportCommandResolutionResult {
  const { requestedCommand } = context;

  if (requestedCommand === "report:unified") {
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      resolved: true,
      canonicalCommand: "report:usage",
      suggestion: "report:usage",
    };
  }

  if (requestedCommand === "report:usage") {
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      resolved: true,
      canonicalCommand: "report:usage",
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
