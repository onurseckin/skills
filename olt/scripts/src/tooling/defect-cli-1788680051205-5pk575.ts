export const DEFECT_ID = "defect-cli-1788680051205-5pk575";
export const ERROR_CODE = "INVALID_ARGUMENT";
export const DEFECT_TITLE =
  "Defect Remediation: unknown command: report:unified; did you mean 'report:usage'?";

export interface ReportUsageResolutionContext {
  readonly rawCommand: string;
  readonly availableReportCommands?: readonly string[];
}

export interface ReportUsageResolutionResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly resolved: boolean;
  readonly canonicalCommand: string;
  readonly suggestion: string;
  readonly error?: string;
}

export function resolveReportUsageCommand(
  context: ReportUsageResolutionContext,
): ReportUsageResolutionResult {
  const { rawCommand } = context;

  if (rawCommand === "report:unified") {
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      resolved: true,
      canonicalCommand: "report:usage",
      suggestion: "report:usage",
    };
  }

  if (rawCommand === "report:usage") {
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      resolved: true,
      canonicalCommand: "report:usage",
      suggestion: "report:usage",
    };
  }

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    resolved: false,
    canonicalCommand: rawCommand,
    suggestion: "report:usage",
    error: `unknown command: ${rawCommand}; did you mean 'report:usage'?`,
  };
}
