export const DEFECT_ID = "defect-cli-1788680928744-29nlml";
export const ERROR_CODE = "INVALID_ARGUMENT";
export const DEFECT_TITLE = "Defect Remediation: unknown command: nope";

export interface CommandDispatchContext29 {
  readonly requestedCommand: string;
  readonly commandRegistry?: readonly string[];
}

export interface CommandDispatchResult29 {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly recognized: boolean;
  readonly error?: string;
}

export function evaluateCommandDispatch29(
  context: CommandDispatchContext29,
): CommandDispatchResult29 {
  const { requestedCommand, commandRegistry = [] } = context;

  if (commandRegistry.includes(requestedCommand)) {
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      recognized: true,
    };
  }

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    recognized: false,
    error: `unknown command: ${requestedCommand}`,
  };
}
