export const DEFECT_ID = "defect-cli-1788682423077-p30xex";
export const ERROR_CODE = "INVALID_ARGUMENT";
export const DEFECT_TITLE = "Defect Remediation: unknown command: nope";

export interface CommandDispatcherContext37 {
  readonly rawCommand: string;
  readonly supportedCommands?: readonly string[];
}

export interface CommandDispatcherResult37 {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly recognized: boolean;
  readonly error?: string;
}

export function dispatchCommand37(context: CommandDispatcherContext37): CommandDispatcherResult37 {
  const { rawCommand, supportedCommands = [] } = context;

  if (supportedCommands.includes(rawCommand)) {
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
    error: `unknown command: ${rawCommand}`,
  };
}
