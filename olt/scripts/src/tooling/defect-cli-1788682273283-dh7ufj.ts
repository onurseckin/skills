export const DEFECT_ID = "defect-cli-1788682273283-dh7ufj";
export const ERROR_CODE = "INVALID_ARGUMENT";
export const DEFECT_TITLE = "Defect Remediation: unknown command: nope";

export interface CommandValidatorContext35 {
  readonly command: string;
  readonly allowedCommands?: readonly string[];
}

export interface CommandValidatorResult35 {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly allowed: boolean;
  readonly error?: string;
}

export function validateCommand35(context: CommandValidatorContext35): CommandValidatorResult35 {
  const { command, allowedCommands = [] } = context;

  if (allowedCommands.includes(command)) {
    return {
      remediated: true,
      defectId: DEFECT_ID,
      errorCode: ERROR_CODE,
      allowed: true,
    };
  }

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    allowed: false,
    error: `unknown command: ${command}`,
  };
}
