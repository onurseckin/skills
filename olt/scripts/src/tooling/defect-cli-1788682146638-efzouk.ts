export const DEFECT_ID = "defect-cli-1788682146638-efzouk";
export const ERROR_CODE = "INVALID_ARGUMENT";
export const DEFECT_TITLE =
  "Defect Remediation: unknown command: report:unified; did you mean 'report:usage'?";

export interface ReportUnifiedCommandDispatchContext {
  readonly command: string;
}

export interface ReportUnifiedCommandDispatchResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly resolved: boolean;
  readonly canonicalCommand: string;
  readonly suggestion: string;
  readonly error?: string;
}

export function handleReportUnifiedCommand(
  context: ReportUnifiedCommandDispatchContext,
): ReportUnifiedCommandDispatchResult {
  const { command } = context;

  if (command === "report:unified") {
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
    canonicalCommand: command,
    suggestion: "report:usage",
    error: `unknown command: ${command}; did you mean 'report:usage'?`,
  };
}
