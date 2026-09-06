export const DEFECT_ID = "defect-cli-1788680406655-ypjbmj";
export const ERROR_CODE = "INVALID_ARGUMENT";
export const DEFECT_TITLE =
  "Defect Remediation: unknown command: report:unified; did you mean 'report:usage'?";

export interface ReportUnifiedCommandContext {
  readonly command: string;
  readonly options?: readonly string[];
}

export interface ReportUnifiedCommandResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly resolved: boolean;
  readonly target: string;
  readonly suggestion: string;
  readonly error?: string;
}

export function resolveReportUnifiedAlias(
  context: ReportUnifiedCommandContext,
): ReportUnifiedCommandResult {
  const { command } = context;

  if (command === "report:unified") {
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      resolved: true,
      target: "report:usage",
      suggestion: "report:usage",
    };
  }

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    resolved: false,
    target: command,
    suggestion: "report:usage",
    error: `unknown command: ${command}; did you mean 'report:usage'?`,
  };
}
