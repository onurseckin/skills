export const DEFECT_ID = "defect-cli-1788682002548-9qp3k3";
export const ERROR_CODE = "INVALID_ARGUMENT";
export const DEFECT_TITLE =
  "Defect Remediation: unknown command: report:dag; did you mean 'report:get'?";

export interface ReportDagResolutionContext {
  readonly requestedCommand: string;
}

export interface ReportDagResolutionResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly resolved: boolean;
  readonly canonicalCommand: string;
  readonly suggestion: string;
  readonly error?: string;
}

export function resolveReportDagCommand(
  context: ReportDagResolutionContext,
): ReportDagResolutionResult {
  const { requestedCommand } = context;

  if (requestedCommand === "report:dag") {
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      resolved: true,
      canonicalCommand: "report:get",
      suggestion: "report:get",
    };
  }

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    resolved: false,
    canonicalCommand: requestedCommand,
    suggestion: "report:get",
    error: `unknown command: ${requestedCommand}; did you mean 'report:get'?`,
  };
}
